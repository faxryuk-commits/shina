/**
 * Unified Delever client. Routes calls either to the real Delever API V2
 * or to the in-memory mock dataset depending on the USE_MOCKS env flag.
 *
 * The shape of the data returned to the MCP layer is intentionally
 * simplified: localized strings are pre-resolved to one chosen language,
 * the stop list is merged into menu items as a boolean `available` flag,
 * etc. This keeps tool outputs friendly for the LLM to read.
 */

import { getDeleverAccessToken } from "./deleverAuth";
import {
  MOCK_AVAILABILITY,
  MOCK_MENUS,
  MOCK_RESTAURANTS,
  MOCK_RESTAURANT_AVAILABILITY,
  type LangCode,
  type Localized,
  type MockMenuComposition,
  type MockMenuItem,
  type MockRestaurant,
} from "./mockData";

export type { LangCode } from "./mockData";

export interface RestaurantSummary {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  online: boolean;
}

export interface MenuModifierOption {
  id: string;
  name: string;
  price: number;
}

export interface MenuModifier {
  id: string;
  name: string;
  min: number;
  max: number;
  options: MenuModifierOption[];
}

export interface MenuItem {
  id: string;
  category: string;
  name: string;
  description: string;
  price: number;
  weight_g: number;
  available: boolean;
  modifiers: MenuModifier[];
}

export interface MenuResult {
  restaurant_id: string;
  language: LangCode;
  last_change: string;
  items: MenuItem[];
}

export interface OrderItemInput {
  item_id: string;
  quantity: number;
  modifier_ids?: string[];
}

export interface DeliveryInfo {
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
}

export type PaymentType = "CARD" | "CASH";

export interface CreateOrderInput {
  restaurant_id: string;
  items: OrderItemInput[];
  delivery: DeliveryInfo;
  payment: PaymentType;
  comment?: string;
}

export interface CreateOrderResult {
  order_id: string;
  total: number;
  status: OrderStatus;
}

export type OrderStatus =
  | "ACCEPTED"
  | "COOKING"
  | "READY"
  | "TAKEN_BY_COURIER"
  | "DELIVERED"
  | "CANCELLED";

export interface OrderStatusResult {
  order_id: string;
  status: OrderStatus;
  updated_at: string;
}

function isMockMode(): boolean {
  // Default to mocks unless explicitly disabled.
  return process.env.USE_MOCKS !== "false";
}

function pickLang(localized: Localized, lang: LangCode): string {
  return localized[lang] || localized.ru || localized.en || "";
}

/* ---------------------------------------------------------------------- */
/* In-memory order store (mock mode only). Cleared on cold start.         */
/* ---------------------------------------------------------------------- */

interface MockOrderRecord {
  order_id: string;
  restaurant_id: string;
  items: OrderItemInput[];
  delivery: DeliveryInfo;
  payment: PaymentType;
  comment?: string;
  total: number;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
}

const mockOrders = new Map<string, MockOrderRecord>();

function newMockOrderId(): string {
  return `ord_mock_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function calcMockTotal(
  menu: MockMenuComposition,
  items: OrderItemInput[]
): number {
  let total = 0;
  for (const line of items) {
    const dish = menu.items.find((d) => d.id === line.item_id);
    if (!dish) continue;
    let lineTotal = dish.price;
    for (const modId of line.modifier_ids || []) {
      for (const mod of dish.modifiers) {
        const opt = mod.options.find((o) => o.id === modId);
        if (opt) lineTotal += opt.price;
      }
    }
    total += lineTotal * line.quantity;
  }
  return total;
}

/* ---------------------------------------------------------------------- */
/* Real Delever API helpers                                                */
/* ---------------------------------------------------------------------- */

async function deleverFetch(
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const baseUrl = (process.env.DELEVER_BASE_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error(
      "DELEVER_BASE_URL is required when USE_MOCKS=false. Set it in env."
    );
  }
  const token = await getDeleverAccessToken();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Delever API ${path} failed: ${response.status} ${response.statusText} — ${text}`
    );
  }
  if (response.status === 204) return null;
  return response.json();
}

/* ---------------------------------------------------------------------- */
/* Public client surface                                                   */
/* ---------------------------------------------------------------------- */

export interface SearchRestaurantsParams {
  query?: string;
  only_available?: boolean;
  language?: LangCode;
}

export async function searchRestaurants(
  params: SearchRestaurantsParams = {}
): Promise<RestaurantSummary[]> {
  const lang: LangCode = params.language || "ru";

  if (isMockMode()) {
    const availability = new Map(
      MOCK_RESTAURANT_AVAILABILITY.map((r) => [r.id, r.enabled])
    );
    return filterRestaurants(
      MOCK_RESTAURANTS.map((r) => toSummary(r, availability.get(r.id) ?? false, lang)),
      params
    );
  }

  type ApiRestaurant = {
    id: string;
    name: Localized | string;
    address: Localized | string;
    location?: { lat: number; long: number };
  };
  type ApiAvailability = { id: string; enabled: boolean };

  const [restaurantsRaw, availabilityRaw] = await Promise.all([
    deleverFetch("/restaurants") as Promise<ApiRestaurant[]>,
    deleverFetch("/restaurants/availability") as Promise<ApiAvailability[]>,
  ]);

  const availability = new Map(
    (availabilityRaw || []).map((a) => [a.id, a.enabled])
  );

  const summaries = (restaurantsRaw || []).map((r) => ({
    id: r.id,
    name:
      typeof r.name === "string" ? r.name : pickLang(r.name as Localized, lang),
    address:
      typeof r.address === "string"
        ? r.address
        : pickLang(r.address as Localized, lang),
    lat: r.location?.lat ?? 0,
    lng: r.location?.long ?? 0,
    online: availability.get(r.id) ?? false,
  }));

  return filterRestaurants(summaries, params);
}

function toSummary(
  r: MockRestaurant,
  online: boolean,
  lang: LangCode
): RestaurantSummary {
  return {
    id: r.id,
    name: pickLang(r.name, lang),
    address: pickLang(r.address, lang),
    lat: r.location.lat,
    lng: r.location.long,
    online,
  };
}

function filterRestaurants(
  list: RestaurantSummary[],
  params: SearchRestaurantsParams
): RestaurantSummary[] {
  let out = list;
  if (params.only_available) {
    out = out.filter((r) => r.online);
  }
  if (params.query && params.query.trim()) {
    const q = params.query.trim().toLowerCase();
    out = out.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
    );
  }
  return out;
}

export interface GetMenuParams {
  restaurant_id: string;
  language?: LangCode;
}

export async function getMenu(params: GetMenuParams): Promise<MenuResult> {
  const lang: LangCode = params.language || "ru";

  if (isMockMode()) {
    const menu = MOCK_MENUS[params.restaurant_id];
    if (!menu) {
      throw new Error(`Restaurant ${params.restaurant_id} not found.`);
    }
    const stockMap = buildStockMap(MOCK_AVAILABILITY[params.restaurant_id]);
    return formatMenu(menu, stockMap, lang);
  }

  type ApiCategory = { id: string; parentId: string | null; name: Localized };
  type ApiModifierOption = { id: string; name: Localized; price: number };
  type ApiModifier = {
    id: string;
    name: Localized;
    min: number;
    max: number;
    options: ApiModifierOption[];
  };
  type ApiItem = {
    id: string;
    categoryId: string;
    name: Localized;
    description: Localized;
    price: number;
    weight: number;
    modifiers?: ApiModifier[];
  };
  type ApiComposition = {
    categories: ApiCategory[];
    items: ApiItem[];
    lastChange?: string;
  };
  type ApiAvailability = {
    items?: { id: string; stock: number }[];
    modifiers?: { id: string; stock: number }[];
  };

  const [composition, availability] = await Promise.all([
    deleverFetch(
      `/menu/${encodeURIComponent(params.restaurant_id)}/composition`
    ) as Promise<ApiComposition>,
    deleverFetch(
      `/menu/${encodeURIComponent(params.restaurant_id)}/availability`
    ) as Promise<ApiAvailability>,
  ]);

  const stockMap = new Map<string, number>();
  for (const it of availability?.items || []) {
    stockMap.set(it.id, it.stock);
  }

  const categoryMap = new Map<string, string>();
  for (const c of composition.categories) {
    categoryMap.set(c.id, pickLang(c.name, lang));
  }

  const items: MenuItem[] = composition.items.map((it) => ({
    id: it.id,
    category: categoryMap.get(it.categoryId) || "",
    name: pickLang(it.name, lang),
    description: pickLang(it.description, lang),
    price: it.price,
    weight_g: it.weight,
    available: !stockMap.has(it.id) || (stockMap.get(it.id) ?? 0) > 0,
    modifiers: (it.modifiers || []).map((m) => ({
      id: m.id,
      name: pickLang(m.name, lang),
      min: m.min,
      max: m.max,
      options: m.options.map((o) => ({
        id: o.id,
        name: pickLang(o.name, lang),
        price: o.price,
      })),
    })),
  }));

  return {
    restaurant_id: params.restaurant_id,
    language: lang,
    last_change: composition.lastChange || new Date().toISOString(),
    items,
  };
}

function buildStockMap(
  availability: { items: { id: string; stock: number }[] } | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of availability?.items || []) {
    map.set(it.id, it.stock);
  }
  return map;
}

function formatMenu(
  menu: MockMenuComposition,
  stockMap: Map<string, number>,
  lang: LangCode
): MenuResult {
  const categoryMap = new Map<string, string>();
  for (const c of menu.categories) {
    categoryMap.set(c.id, pickLang(c.name, lang));
  }
  const items: MenuItem[] = menu.items.map((it: MockMenuItem) => ({
    id: it.id,
    category: categoryMap.get(it.categoryId) || "",
    name: pickLang(it.name, lang),
    description: pickLang(it.description, lang),
    price: it.price,
    weight_g: it.weight,
    available: !stockMap.has(it.id) || (stockMap.get(it.id) ?? 0) > 0,
    modifiers: it.modifiers.map((m) => ({
      id: m.id,
      name: pickLang(m.name, lang),
      min: m.min,
      max: m.max,
      options: m.options.map((o) => ({
        id: o.id,
        name: pickLang(o.name, lang),
        price: o.price,
      })),
    })),
  }));
  return {
    restaurant_id: menu.restaurantId,
    language: lang,
    last_change: menu.lastChange,
    items,
  };
}

export async function createOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  if (isMockMode()) {
    const menu = MOCK_MENUS[input.restaurant_id];
    if (!menu) {
      throw new Error(`Restaurant ${input.restaurant_id} not found.`);
    }
    const stockMap = buildStockMap(MOCK_AVAILABILITY[input.restaurant_id]);
    for (const line of input.items) {
      const dish = menu.items.find((d) => d.id === line.item_id);
      if (!dish) {
        throw new Error(
          `Item ${line.item_id} is not on the menu of ${input.restaurant_id}.`
        );
      }
      if (stockMap.has(line.item_id) && (stockMap.get(line.item_id) ?? 0) <= 0) {
        throw new Error(
          `Item ${line.item_id} (${dish.name.ru}) is currently out of stock.`
        );
      }
    }
    const total = calcMockTotal(menu, input.items);
    const order_id = newMockOrderId();
    const now = new Date().toISOString();
    mockOrders.set(order_id, {
      order_id,
      restaurant_id: input.restaurant_id,
      items: input.items,
      delivery: input.delivery,
      payment: input.payment,
      comment: input.comment,
      total,
      status: "ACCEPTED",
      created_at: now,
      updated_at: now,
    });
    return { order_id, total, status: "ACCEPTED" };
  }

  const body = {
    restaurantId: input.restaurant_id,
    discriminator: "aggregator",
    eatsId: `mcp_${Date.now()}`,
    payment: input.payment,
    comment: input.comment || "",
    delivery: {
      name: input.delivery.name,
      phone: input.delivery.phone,
      address: input.delivery.address,
      location: { lat: input.delivery.lat, long: input.delivery.lng },
    },
    items: input.items.map((it) => ({
      id: it.item_id,
      quantity: it.quantity,
      modifiers: (it.modifier_ids || []).map((id) => ({ id })),
    })),
  };

  const result = (await deleverFetch("/order", {
    method: "POST",
    body: JSON.stringify(body),
  })) as { id?: string; orderId?: string; total?: number; status?: OrderStatus };

  const order_id = result.orderId || result.id;
  if (!order_id) {
    throw new Error(
      `Delever did not return an order id: ${JSON.stringify(result)}`
    );
  }
  return {
    order_id,
    total: result.total ?? 0,
    status: result.status ?? "ACCEPTED",
  };
}

export async function getOrderStatus(
  order_id: string
): Promise<OrderStatusResult> {
  if (isMockMode()) {
    const record = mockOrders.get(order_id);
    if (!record) {
      throw new Error(
        `Order ${order_id} not found. (Mock storage is reset on cold start.)`
      );
    }
    return {
      order_id,
      status: record.status,
      updated_at: record.updated_at,
    };
  }

  const result = (await deleverFetch(
    `/order/${encodeURIComponent(order_id)}/status`
  )) as { status?: OrderStatus; updatedAt?: string };

  return {
    order_id,
    status: result.status ?? "ACCEPTED",
    updated_at: result.updatedAt || new Date().toISOString(),
  };
}

export async function cancelOrder(
  order_id: string,
  reason: string
): Promise<{ order_id: string; status: OrderStatus }> {
  if (isMockMode()) {
    const record = mockOrders.get(order_id);
    if (!record) {
      throw new Error(
        `Order ${order_id} not found. (Mock storage is reset on cold start.)`
      );
    }
    record.status = "CANCELLED";
    record.updated_at = new Date().toISOString();
    return { order_id, status: "CANCELLED" };
  }

  await deleverFetch(`/order/${encodeURIComponent(order_id)}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
  return { order_id, status: "CANCELLED" };
}
