/**
 * Streamable HTTP MCP endpoint. Handles both /api/mcp (modern transport)
 * and /api/sse (legacy SSE transport for older MCP clients).
 *
 * Tools exposed:
 *   - search_restaurants
 *   - get_menu
 *   - create_order
 *   - get_order
 *   - get_order_status
 *   - update_order_status
 *   - cancel_order
 *   - list_promo_items
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
  item_id: z.string().min(1).describe("Menu item id from get_menu output"),
  quantity: z
    .number()
    .int()
    .min(1)
    .describe("How many portions of this item"),
  modifier_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Selected modifier option ids (e.g. size_large, oat_milk). Pulled from item.modifiers[].options[].id."
    ),
});

const deliverySchema = z.object({
  name: z.string().min(1).describe("Customer name for the courier"),
  phone: z
    .string()
    .min(5)
    .describe("Customer phone in international format, e.g. +998901234567"),
  address: z.string().min(1).describe("Free-form delivery address"),
  lat: z.number().min(-90).max(90).describe("Delivery latitude"),
  lng: z.number().min(-180).max(180).describe("Delivery longitude"),
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

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search_restaurants",
      {
        title: "Search Delever restaurants",
        description:
          "Find restaurants connected to Delever. Returns id, name, address, " +
          "coordinates and online status. Use this first to obtain a restaurant_id " +
          "that other tools require.",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: {
          query: z
            .string()
            .optional()
            .describe(
              "Optional case-insensitive substring matched against name or address."
            ),
          only_available: z
            .boolean()
            .optional()
            .describe("If true, hide restaurants that are currently offline."),
          language: langEnum
            .optional()
            .describe("Output language (default ru)."),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
      tracedTool<SearchRestaurantsArgs>("search_restaurants", async (args) => {
        const data = await searchRestaurants(args);
        return { count: data.length, restaurants: data };
      })
    );

    server.registerTool(
      "get_menu",
      {
        title: "Get restaurant menu",
        description:
          "Fetch the full menu for a restaurant. Returns items with prices, " +
          "a `measure`/`measure_unit` pair (e.g. 500/'мл'), modifiers and an " +
          "`available` flag (false means the item is in the stop list). Always " +
          "call this before create_order to obtain valid item_ids.",
        inputSchema: {
          restaurant_id: z
            .string()
            .min(1)
            .describe("Restaurant id from search_restaurants output."),
          language: langEnum
            .optional()
            .describe("Menu language (default ru)."),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
      tracedTool<GetMenuArgs>("get_menu", (args) => getMenu(args))
    );

    server.registerTool(
      "create_order",
      {
        title: "Place a delivery order",
        description:
          "Create an order on the restaurant's POS. Confirm all details with " +
          "the user (items, address, phone, payment) before calling this tool. " +
          "The order is placed immediately and cannot be silently undone — use " +
          "cancel_order if the user changes their mind.",
        inputSchema: {
          restaurant_id: z.string().min(1),
          items: z.array(orderItemSchema).min(1),
          delivery: deliverySchema,
          payment: paymentEnum.describe(
            "CARD = pay by card, CASH = pay cash to courier"
          ),
          comment: z
            .string()
            .optional()
            .describe("Optional comment for the kitchen or courier."),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
      tracedTool<CreateOrderArgs>("create_order", (args) => createOrder(args))
    );

    server.registerTool(
      "get_order_status",
      {
        title: "Get order status",
        description:
          "Check the current status of an order placed via create_order. " +
          "Possible statuses: ACCEPTED, COOKING, READY, TAKEN_BY_COURIER, DELIVERED, CANCELLED.",
        inputSchema: {
          order_id: z
            .string()
            .min(1)
            .describe("Order id returned by create_order."),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        description:
          "Cancel a previously placed order. Provide a short human-readable reason " +
          "so the restaurant understands why.",
        inputSchema: {
          order_id: z.string().min(1),
          reason: z
            .string()
            .min(1)
            .describe("Why the order is being cancelled."),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        description:
          "Fetch a previously created order with all of its items, delivery " +
          "details, payment info and totals. Prefer get_order_status when " +
          "you only need the current state — get_order is heavier.",
        inputSchema: {
          order_id: z
            .string()
            .min(1)
            .describe("Order id returned by create_order."),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
      tracedTool<GetOrderArgs>("get_order", (args) => getOrder(args.order_id))
    );

    server.registerTool(
      "update_order_status",
      {
        title: "Update order status",
        description:
          "Push a status update for an existing order. Allowed values are " +
          "DELIVERED, TAKEN_BY_COURIER and CANCELLED. Prefer cancel_order for " +
          "user-initiated cancellations (it provides a clearer mental model " +
          "and a richer reason field); use this tool when integrating courier " +
          "or POS state-machine signals.",
        inputSchema: {
          order_id: z
            .string()
            .min(1)
            .describe("Order id returned by create_order."),
          status: updateOrderStatusEnum.describe(
            "New status: DELIVERED, TAKEN_BY_COURIER, or CANCELLED."
          ),
          comment: z
            .string()
            .optional()
            .describe("Optional human-readable note attached to the update."),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        description:
          "Fetch the list of menu items participating in promotional " +
          "campaigns for a restaurant. Returns pairs of (item_id, promo_id). " +
          "Use this to surface discounts to the user before placing an order.",
        inputSchema: {
          restaurant_id: z
            .string()
            .min(1)
            .describe("Restaurant id from search_restaurants output."),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
      tracedTool<ListPromoItemsArgs>("list_promo_items", (args) =>
        listPromoItems(args.restaurant_id)
      )
    );
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== "production",
  }
);

export { handler as GET, handler as POST, handler as DELETE };
