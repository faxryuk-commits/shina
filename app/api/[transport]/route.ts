/**
 * Streamable HTTP MCP endpoint. Handles both /api/mcp (modern transport)
 * and /api/sse (legacy SSE transport for older MCP clients).
 *
 * Tools exposed (in canonical workflow order):
 *   - search_restaurants       — STEP 1: pick a branch
 *   - get_menu                 — STEP 2: pick items
 *   - list_promo_items         — STEP 2.5 (optional): surface discounts
 *   - create_order             — STEP 3: place the order
 *   - get_order_status         — STEP 4a: light-weight status poll
 *   - get_order                — STEP 4b: full order details
 *   - cancel_order             — user-initiated cancellation
 *   - update_order_status      — POS/courier-side state-machine signal
 *
 * Note on `inputSchema as any` casts below: this is the documented
 * workaround for upstream issue
 *   https://github.com/modelcontextprotocol/typescript-sdk/issues/985
 * where `registerTool` triggers TS2589 ("Type instantiation is excessively
 * deep") on schemas that mix `.optional()` with multiple fields. The cast
 * has zero runtime effect — the SDK normalizes the raw shape on its end.
 * Callback parameter types are restated explicitly so we keep type safety
 * inside the handler.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  cancelOrder,
  createOrder,
  getMenu,
  getOrder,
  getOrderStatus,
  listPromoItems,
  searchRestaurants,
  updateOrderStatus,
  type LangCode,
  type PaymentType,
  type UpdateOrderStatus,
} from "@/lib/deleverClient";
import { logEvent } from "@/lib/eventLog";

const langEnum = z.enum(["ru", "en", "uz"]);
const paymentEnum = z.enum(["CARD", "CASH"]);

const orderItemSchema = z.object({
  item_id: z
    .string()
    .min(1)
    .describe(
      "Menu item id (UUID) returned by get_menu in items[].id. NEVER make up an id; if the user names a dish, look it up in get_menu output first."
    ),
  quantity: z
    .number()
    .int()
    .min(1)
    .describe("How many portions of this item. Must be a positive integer."),
  modifier_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Selected modifier-option ids from item.modifiers[].options[].id. Respect each modifier group's `min`/`max` bounds. Omit (or pass []) when the user did not request any extras."
    ),
});

const deliverySchema = z.object({
  name: z.string().min(1).describe("Customer name shown to the courier."),
  phone: z
    .string()
    .min(5)
    .describe(
      "Customer phone in international format. For Uzbekistan it's +998 followed by 9 digits, e.g. +998901234567. Do NOT pass a local format like 8 (90) 123-45-67."
    ),
  address: z
    .string()
    .min(1)
    .describe(
      "Free-form delivery address — include city, street, building, apt/floor/landmark when available, in one human-readable string."
    ),
  lat: z
    .number()
    .min(-90)
    .max(90)
    .describe(
      "Delivery latitude (decimal degrees). REQUIRED. Do not invent — if the user only gave you a free-form address, ask them for the coordinates or for a more precise address that you can geocode externally before calling create_order."
    ),
  lng: z
    .number()
    .min(-180)
    .max(180)
    .describe(
      "Delivery longitude (decimal degrees). REQUIRED. Same warning as `lat`: never guess."
    ),
});

interface SearchRestaurantsArgs {
  query?: string;
  only_available?: boolean;
  language?: LangCode;
}

interface GetMenuArgs {
  restaurant_id: string;
  language?: LangCode;
}

interface CreateOrderArgs {
  restaurant_id: string;
  items: {
    item_id: string;
    quantity: number;
    modifier_ids?: string[];
  }[];
  delivery: {
    name: string;
    phone: string;
    address: string;
    lat: number;
    lng: number;
  };
  payment: PaymentType;
  comment?: string;
}

interface GetOrderStatusArgs {
  order_id: string;
}

interface CancelOrderArgs {
  order_id: string;
  reason: string;
}

interface GetOrderArgs {
  order_id: string;
}

interface UpdateOrderStatusArgs {
  order_id: string;
  status: UpdateOrderStatus;
  comment?: string;
}

interface ListPromoItemsArgs {
  restaurant_id: string;
}

const updateOrderStatusEnum = z.enum([
  "DELIVERED",
  "CANCELLED",
  "TAKEN_BY_COURIER",
]);

function asJsonResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function asError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Error: ${message}`,
      },
    ],
  };
}

/**
 * Wrap a tool handler so every invocation is recorded in the monitor log
 * (input, output, latency, error). Underlying Delever HTTP calls are also
 * logged independently inside `lib/deleverClient.ts`, so a single MCP call
 * may produce multiple monitor events — that's intentional.
 */
function tracedTool<TArgs>(
  toolName: string,
  fn: (args: TArgs) => Promise<unknown>
) {
  return async (args: TArgs): Promise<CallToolResult> => {
    const start = Date.now();
    try {
      const data = await fn(args);
      logEvent({
        kind: "mcp_tool",
        label: toolName,
        ok: true,
        latencyMs: Date.now() - start,
        request: args,
        response: data,
      });
      return asJsonResult(data);
    } catch (error) {
      logEvent({
        kind: "mcp_tool",
        label: toolName,
        ok: false,
        latencyMs: Date.now() - start,
        request: args,
        error: error instanceof Error ? error.message : String(error),
      });
      return asError(error);
    }
  };
}

/**
 * Server-level instructions are sent to the LLM at session start (per the
 * MCP spec). They behave like a system prompt scoped to this connector —
 * Claude.ai, Claude Desktop and ChatGPT custom GPT actions all surface
 * them. Keep them short and prescriptive: tell the model what to ALWAYS
 * do and what NEVER to do.
 */
const SERVER_INSTRUCTIONS = `
You are connected to a Delever-powered food-delivery backend (a chain of
"MAX WAY" branches in Tashkent, Uzbekistan). Use this connector to help the
user search restaurants, browse menus and place real, billable delivery
orders.

# Money & locale
- All prices and totals are in Uzbek soum (UZS). The values are already in
  whole soum — DO NOT divide by 100 or convert to tiyin. Render prices like
  "40 000 сум" (or "40,000 UZS" in English).
- Default communication language is Russian. Switch to English/Uzbek only
  if the user does so first. Pass \`language\` to search_restaurants /
  get_menu accordingly ("ru" | "en" | "uz").
- Phone numbers are Uzbekistan numbers in international format:
  +998 followed by 9 digits, e.g. +998901234567.

# Canonical order workflow
1. search_restaurants → pick a single branch with the user. Each result
   carries a \`menu_stats\` summary (categories_count, items_count,
   unavailable_count) — use it to skip empty-menu branches early.
2. get_menu({restaurant_id}) → show the user real items, prices and
   stop-list (\`available: false\` means the item is on stop, do not offer
   it). Optionally call list_promo_items first if the user asks about
   discounts.
3. CONFIRM with the user the full order summary BEFORE calling
   create_order: items + quantities + modifiers + delivery address +
   phone + payment method + total cost. Read it back, ask "оформляем?".
4. create_order(...) ONCE. If the user repeats the request after a
   successful create_order, do NOT place a second order — instead call
   get_order_status with the existing order_id and report it.
5. After placing, you can poll get_order_status until DELIVERED or
   CANCELLED, or call get_order for a full snapshot.

# Hard rules
- Never invent restaurant_id, item_id, modifier_id or order_id. They are
  UUIDs — always copy them verbatim from a previous tool response.
- Never invent delivery coordinates (lat/lng). If the user only gave a
  free-form address, ASK them to confirm a pin/coordinates or to give a
  more specific address you can geocode externally — do NOT call
  create_order with guessed coordinates.
- Never call update_order_status from a customer-facing chat. That tool
  is for POS/courier integration; ending a customer-initiated order is
  done via cancel_order with a human-readable reason.
- If a tool returns an error, show its message to the user and ask what
  to do next; do NOT silently retry with the same arguments.

# What this server is NOT
- Not a payment gateway: payment="CARD" means the customer will pay by
  card on delivery, not that you charge a card here.
- Not a geocoder: it does not look up coordinates from text addresses.
- Not idempotent: every successful create_order produces a real,
  chargeable order.
`.trim();

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search_restaurants",
      {
        title: "Search Delever restaurants",
        description: [
          "STEP 1 of the order workflow: list the branches connected to this",
          "Delever account.",
          "",
          "Returns each branch with: id (UUID, required for every other tool),",
          "name, address, lat/lng, online flag (true = currently accepting",
          "orders), details_available (false → only id+online are known), and",
          "an optional menu_stats summary {categories_count, items_count,",
          "unavailable_count, category_names[]} so you can pick a branch",
          "without an extra get_menu call.",
          "",
          "Pass `query` to filter by name/address substring (case-insensitive).",
          "Pass `only_available: true` to skip offline branches. Default",
          "language is `ru`.",
        ].join(" "),
        inputSchema: {
          query: z
            .string()
            .optional()
            .describe(
              "Optional case-insensitive substring matched against name or address. Useful when the user mentions a landmark or district."
            ),
          only_available: z
            .boolean()
            .optional()
            .describe(
              "If true, hide branches that are currently offline (online=false). Default false — you usually want to show offline branches greyed out, not hide them, unless the user is in a hurry."
            ),
          language: langEnum
            .optional()
            .describe("Output language: ru | en | uz. Default ru."),
        } as any,
      },
      tracedTool<SearchRestaurantsArgs>("search_restaurants", async (args) => {
        const data = await searchRestaurants({
          ...args,
          with_menu_stats: true,
          menu_stats_timeout_ms: 6000,
        });
        return { count: data.length, restaurants: data };
      })
    );

    server.registerTool(
      "get_menu",
      {
        title: "Get restaurant menu",
        description: [
          "STEP 2 of the order workflow: fetch the full menu for a single",
          "branch.",
          "",
          "Returns: language, last_change (ISO timestamp of the last menu",
          "edit), categories[] (id, name, item_count, sort_order, optional",
          "schedules — when the category is available for ordering), items[]",
          "(id, category, category_id, name, description, price in UZS,",
          "measure + measure_unit like 400/'г', available flag, stock when",
          "known, modifiers[] with min/max bounds and options[] each carrying",
          "a price), and a summary {categories_count, items_count,",
          "available_count, unavailable_count}.",
          "",
          "Always call this before create_order to validate every item_id and",
          "to discover which modifiers a dish supports. Items where",
          "available=false are on stop — never include them in create_order.",
        ].join(" "),
        inputSchema: {
          restaurant_id: z
            .string()
            .min(1)
            .describe(
              "Branch id (UUID) returned by search_restaurants. Do not invent."
            ),
          language: langEnum
            .optional()
            .describe("Menu language: ru | en | uz. Default ru."),
        } as any,
      },
      tracedTool<GetMenuArgs>("get_menu", (args) => getMenu(args))
    );

    server.registerTool(
      "create_order",
      {
        title: "Place a delivery order (irreversible)",
        description: [
          "STEP 3 of the order workflow: create a real, chargeable delivery",
          "order on the restaurant's POS.",
          "",
          "Pre-conditions you MUST satisfy before calling:",
          "  • You called search_restaurants and have a real restaurant_id.",
          "  • You called get_menu and every item_id / modifier_id you pass",
          "    came verbatim from that response, all items have available=true.",
          "  • You confirmed with the user the full order: items, modifiers,",
          "    delivery address, phone, payment method and total cost in UZS.",
          "  • You have real lat/lng for the delivery address — never guess.",
          "",
          "Returns {order_id, total, status: 'ACCEPTED'}. The order is now",
          "live: kitchens get notified, the courier is dispatched. To",
          "abandon, use cancel_order — there is no silent undo.",
          "",
          "If the user repeats the request after a successful call, do NOT",
          "call create_order a second time; instead call get_order_status",
          "with the existing order_id and report what you find.",
        ].join(" "),
        inputSchema: {
          restaurant_id: z
            .string()
            .min(1)
            .describe(
              "Branch id from search_restaurants. Must exactly match the branch whose menu you used to pick item_ids."
            ),
          items: z
            .array(orderItemSchema)
            .min(1)
            .describe(
              "Order line items. Empty arrays are rejected. Each item must reference an in-stock dish from get_menu."
            ),
          delivery: deliverySchema,
          payment: paymentEnum.describe(
            "How the customer will pay the courier on delivery. CARD = card-on-delivery, CASH = cash. This connector does NOT charge the customer here."
          ),
          comment: z
            .string()
            .optional()
            .describe(
              "Optional free-form note for the kitchen or courier (allergies, doorbell broken, leave at door, etc.)."
            ),
        } as any,
      },
      tracedTool<CreateOrderArgs>("create_order", (args) => createOrder(args))
    );

    server.registerTool(
      "get_order_status",
      {
        title: "Get order status (lightweight)",
        description: [
          "STEP 4a: cheap status poll for an order placed via create_order.",
          "Use this in a polling loop instead of get_order when you only need",
          "the current state.",
          "",
          "Statuses the POS may emit: ACCEPTED, COOKING, READY,",
          "TAKEN_BY_COURIER, DELIVERED, CANCELLED. Once a terminal state",
          "(DELIVERED / CANCELLED) is reached, stop polling.",
        ].join(" "),
        inputSchema: {
          order_id: z
            .string()
            .min(1)
            .describe(
              "Order id (UUID) returned by create_order. Never invent."
            ),
        } as any,
      },
      tracedTool<GetOrderStatusArgs>("get_order_status", (args) =>
        getOrderStatus(args.order_id)
      )
    );

    server.registerTool(
      "cancel_order",
      {
        title: "Cancel an order",
        description: [
          "Customer-initiated cancellation. Use this when the user changes",
          "their mind, decides on a different restaurant, or asks you to",
          "abort. Provide a short, human-readable `reason` so the restaurant",
          "understands why.",
          "",
          "If the order is already in TAKEN_BY_COURIER or DELIVERED state",
          "the cancel may be rejected by the POS — read the error message",
          "back to the user.",
        ].join(" "),
        inputSchema: {
          order_id: z
            .string()
            .min(1)
            .describe("Order id from create_order."),
          reason: z
            .string()
            .min(1)
            .describe(
              "Short cancellation reason in the user's words (Russian preferred). E.g. 'Передумал', 'Заказал с другого филиала'."
            ),
        } as any,
      },
      tracedTool<CancelOrderArgs>("cancel_order", (args) =>
        cancelOrder(args.order_id, args.reason)
      )
    );

    server.registerTool(
      "get_order",
      {
        title: "Get full order details",
        description: [
          "STEP 4b: heavyweight order snapshot with every field — items,",
          "modifications, delivery info, payment, totals, comment, courier.",
          "Prefer get_order_status when only the status is needed (much",
          "smaller payload).",
        ].join(" "),
        inputSchema: {
          order_id: z
            .string()
            .min(1)
            .describe("Order id (UUID) returned by create_order."),
        } as any,
      },
      tracedTool<GetOrderArgs>("get_order", (args) => getOrder(args.order_id))
    );

    server.registerTool(
      "update_order_status",
      {
        title: "Update order status (POS / courier integration)",
        description: [
          "Push a status update for an existing order. Allowed values:",
          "DELIVERED, TAKEN_BY_COURIER, CANCELLED.",
          "",
          "DO NOT call this tool from a customer-facing chat. It exists for",
          "POS/courier-side state-machine signals (e.g. wiring a delivery",
          "tablet to mark orders DELIVERED). For customer-initiated",
          "cancellations always use cancel_order — it provides a clearer",
          "mental model and a richer reason field.",
        ].join(" "),
        inputSchema: {
          order_id: z
            .string()
            .min(1)
            .describe("Order id (UUID) returned by create_order."),
          status: updateOrderStatusEnum.describe(
            "New status: DELIVERED | TAKEN_BY_COURIER | CANCELLED."
          ),
          comment: z
            .string()
            .optional()
            .describe(
              "Optional human-readable note attached to the update (visible to the restaurant)."
            ),
        } as any,
      },
      tracedTool<UpdateOrderStatusArgs>("update_order_status", (args) =>
        updateOrderStatus(args.order_id, args.status, args.comment)
      )
    );

    server.registerTool(
      "list_promo_items",
      {
        title: "List promo items in a menu",
        description: [
          "STEP 2.5 (optional): fetch the list of menu items that are part",
          "of an active promotional campaign on this branch. Returns pairs",
          "of (item_id, promo_id). Cross-reference item_id with get_menu",
          "output to surface the discounted dishes to the user.",
        ].join(" "),
        inputSchema: {
          restaurant_id: z
            .string()
            .min(1)
            .describe("Branch id (UUID) from search_restaurants."),
        } as any,
      },
      tracedTool<ListPromoItemsArgs>("list_promo_items", (args) =>
        listPromoItems(args.restaurant_id)
      )
    );
  },
  {
    serverInfo: {
      name: "delever-mcp",
      version: "0.2.0",
    },
    instructions: SERVER_INSTRUCTIONS,
    capabilities: {
      tools: {},
    },
  },
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== "production",
  }
);

export { handler as GET, handler as POST, handler as DELETE };
