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
import { logEvent } from "./eventLog";
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

export interface MenuStats {
  /** Number of categories the branch has in its menu. */
  categories_count: number;
  /** Number of items in the menu. */
  items_count: number;
  /** Items currently unavailable (on stop). */
  unavailable_count: number;
  /**
   * First few category names (resolved in caller's language) — used as a
   * "fingerprint" for branches whose `/restaurants` details are not exposed
   * (Delever's 10-item cap), so the UI still shows _something_ recognisable.
   */
  category_names: string[];
  /** Restaurant menu's `lastChange` ISO timestamp. */
  last_change: string;
  /**
   * True if either the composition or availability call failed; counts may
   * be partial. Surfaces as "—" in the UI.
   */
  error?: string;
}

export interface RestaurantSummary {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  online: boolean;
  /**
   * False when only the id + online flag is known because Delever's
   * `GET /restaurants` capped at 10 entries and this branch wasn't in
   * that subset (the rest of the data lives only behind the menu/order
   * endpoints, which work fine for all branches).
   */
  details_available: boolean;
  /**
   * Optional menu stats, populated when `with_menu_stats=true` is passed
   * to `searchRestaurants`.
   */
  menu_stats?: MenuStats;
}

export interface MenuModifierOption {
  id: string;
  name: string;
  price: number;
  /** Per-option count limits (Delever spec: minAmount/maxAmount). */
  min_amount?: number;
  max_amount?: number;
}

export interface MenuModifier {
  id: string;
  name: string;
  /** Group-level selection limits (Delever spec: minSelectedModifiers / maxSelectedModifiers). */
  min: number;
  max: number;
  options: MenuModifierOption[];
}

export interface MenuItem {
  id: string;
  category: string;
  /** ID of the category this item belongs to. */
  category_id: string;
  name: string;
  description: string;
  price: number;
  /**
   * Numeric measure value (Delever `measure`). Interpret in conjunction with
   * `measure_unit` — could be grams, millilitres, pieces, etc.
   */
  measure: number;
  /** Unit for `measure` (Delever `measureUnit`), e.g. "г", "мл", "шт". */
  measure_unit: string;
  available: boolean;
  /**
   * Numeric stock if Delever returned one in `/menu/{id}/availability`. Absent
   * key = no availability record (item is in stock by default). 0 = explicit
   * stop. Positive number = remaining quantity.
   */
  stock?: number;
  /** Optional product image URL (first one from Delever `images[]`). */
  image_url?: string;
  modifiers: MenuModifier[];
  sort_order?: number;
}

/** One category-level schedule slot (Delever spec). */
export interface ScheduleSlot {
  from: string;
  till: string;
  weekdays: string[];
}

export interface MenuCategory {
  id: string;
  name: string;
  parent_id?: string;
  sort_order?: number;
  /** How many items in `items[]` belong to this category. */
  item_count: number;
  /** Resolved schedules for this category (empty if none). */
  schedules: ScheduleSlot[];
  /** Optional category icon URL. */
  image_url?: string;
}

export interface MenuSummary {
  categories_count: number;
  items_count: number;
  available_count: number;
  unavailable_count: number;
}

export interface MenuResult {
  restaurant_id: string;
  language: LangCode;
  last_change: string;
  categories: MenuCategory[];
  items: MenuItem[];
  summary: MenuSummary;
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
  /** Optional human-readable note from Delever (spec: GetOrderByStatus.comment). */
  comment?: string;
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

/**
 * Default path prefix for all Delever Custom Integration V2 endpoints.
 * Override with `DELEVER_API_BASE_PATH=` if Delever publishes a different
 * base path on a future deployment.
 */
const DEFAULT_API_BASE_PATH = "/v1/custom-integration";

async function deleverFetch(
  path: string,
  init: RequestInit & { acceptType?: string } = {}
): Promise<unknown> {
  const baseUrl = (process.env.DELEVER_BASE_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error(
      "DELEVER_BASE_URL is required when USE_MOCKS=false. Set it in env."
    );
  }
  const apiBasePath = (
    process.env.DELEVER_API_BASE_PATH ?? DEFAULT_API_BASE_PATH
  ).replace(/\/$/, "");
  const fullPath = path.startsWith(apiBasePath) ? path : `${apiBasePath}${path}`;

  const token = await getDeleverAccessToken();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", init.acceptType || "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const method = (init.method || "GET").toUpperCase();
  let parsedRequestBody: unknown;
  if (typeof init.body === "string") {
    try {
      parsedRequestBody = JSON.parse(init.body);
    } catch {
      parsedRequestBody = init.body;
    }
  }
  const start = Date.now();

  let response: Response;
  try {
    const fetchInit: RequestInit = { ...init, headers };
    delete (fetchInit as { acceptType?: string }).acceptType;
    response = await fetch(`${baseUrl}${fullPath}`, fetchInit);
  } catch (err) {
    logEvent({
      kind: "delever_http",
      label: fullPath,
      method,
      ok: false,
      latencyMs: Date.now() - start,
      request: parsedRequestBody,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const latencyMs = Date.now() - start;
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    logEvent({
      kind: "delever_http",
      label: fullPath,
      method,
      status: response.status,
      ok: false,
      latencyMs,
      request: parsedRequestBody,
      response: parsed,
      error: `${response.status} ${response.statusText}`,
    });
    throw new Error(
      `Delever API ${fullPath} failed: ${response.status} ${response.statusText} — ${text}`
    );
  }

  logEvent({
    kind: "delever_http",
    label: fullPath,
    method,
    status: response.status,
    ok: true,
    latencyMs,
    request: parsedRequestBody,
    response: parsed,
  });

  if (response.status === 204) return null;
  return parsed;
}

/* ---------------------------------------------------------------------- */
/* Public client surface                                                   */
/* ---------------------------------------------------------------------- */

export interface SearchRestaurantsParams {
  query?: string;
  only_available?: boolean;
  language?: LangCode;
  /**
   * When true, also fetches `/menu/{id}/composition` + `/availability` for
   * each branch in parallel and attaches the resulting `menu_stats` to every
   * `RestaurantSummary`. Adds latency proportional to the slowest menu fetch
   * but bounded by `menu_stats_timeout_ms` (default 6000).
   */
  with_menu_stats?: boolean;
  /** Per-branch menu fetch timeout in milliseconds. Default: 6000. */
  menu_stats_timeout_ms?: number;
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

  // Spec: GET /v1/custom-integration/restaurants → { places: GetRestaurantModel[] }
  // Spec: GET /v1/custom-integration/restaurants/availability → { places: Place[] }
  //
  // Quirk (verified empirically against integrator.api.delever.uz on
  // 2026-04-29): `/restaurants` returns at most 10 entries — no documented
  // pagination parameter (limit / offset / page / cursor) changes the
  // result. `/restaurants/availability` returns the full set with id +
  // enabled. We treat `availability` as the authoritative list of branches
  // and join in details from `/restaurants` when available.
  type ApiRestaurant = {
    id: string;
    title?: string;
    address?: string;
    location?: { lat?: number; long?: number };
  };
  type ApiRestaurantsList = { places?: ApiRestaurant[] };
  type ApiPlace = { id: string; enabled: boolean };
  type ApiAvailabilityList = { places?: ApiPlace[] };

  // Note: GET /restaurants returns plain strings (not localized objects)
  // per spec, so `lang` is only consumed in the mock branch above.

  const [restaurantsRaw, availabilityRaw] = await Promise.all([
    deleverFetch("/restaurants") as Promise<ApiRestaurantsList>,
    deleverFetch("/restaurants/availability") as Promise<ApiAvailabilityList>,
  ]);

  const detailsById = new Map<string, ApiRestaurant>();
  for (const r of restaurantsRaw?.places || []) {
    detailsById.set(r.id, r);
  }

  const availabilityList = availabilityRaw?.places || [];

  // Authoritative list = `availability`; details merged in when known.
  // Falls back to `/restaurants` order if `availability` is empty (mocks
  // and edge cases).
  const baseList: { id: string; online: boolean }[] =
    availabilityList.length > 0
      ? availabilityList.map((a) => ({ id: a.id, online: a.enabled }))
      : (restaurantsRaw?.places || []).map((r) => ({
          id: r.id,
          online: false,
        }));

  const summaries = baseList.map<RestaurantSummary>(({ id, online }) => {
    const details = detailsById.get(id);
    if (details) {
      return {
        id,
        name: details.title || id,
        address: details.address || "",
        lat: details.location?.lat ?? 0,
        lng: details.location?.long ?? 0,
        online,
        details_available: true,
      };
    }
    return {
      id,
      name: id,
      address: "",
      lat: 0,
      lng: 0,
      online,
      details_available: false,
    };
  });

  const filtered = filterRestaurants(summaries, params);

  if (params.with_menu_stats) {
    const timeoutMs = params.menu_stats_timeout_ms ?? 6000;
    const statsPairs = await Promise.all(
      filtered.map(async (r) => {
        try {
          const stats = await withTimeout(
            getMenuStats(r.id, lang),
            timeoutMs,
            `menu stats for ${r.id}`
          );
          return [r.id, stats] as const;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return [
            r.id,
            {
              categories_count: 0,
              items_count: 0,
              unavailable_count: 0,
              category_names: [],
              last_change: "",
              error: message,
            } satisfies MenuStats,
          ] as const;
        }
      })
    );
    const statsById = new Map(statsPairs);
    return filtered.map((r) => ({ ...r, menu_stats: statsById.get(r.id) }));
  }

  return filtered;
}

/**
 * Lightweight menu summary — fetches both composition and availability and
 * returns only the counts the UI needs. Cheaper than `getMenu` because it
 * skips modifier expansion and string allocation per item.
 */
export async function getMenuStats(
  restaurantId: string,
  language: LangCode = "ru"
): Promise<MenuStats> {
  if (isMockMode()) {
    const menu = MOCK_MENUS[restaurantId];
    if (!menu) {
      return {
        categories_count: 0,
        items_count: 0,
        unavailable_count: 0,
        category_names: [],
        last_change: "",
      };
    }
    const stockMap = buildStockMap(MOCK_AVAILABILITY[restaurantId]);
    const unavailable = menu.items.filter(
      (it) => stockMap.has(it.id) && (stockMap.get(it.id) ?? 0) <= 0
    ).length;
    return {
      categories_count: menu.categories.length,
      items_count: menu.items.length,
      unavailable_count: unavailable,
      category_names: menu.categories
        .slice(0, 3)
        .map((c) => pickLang(c.name, language)),
      last_change: menu.lastChange,
    };
  }

  type ApiCategoryLite = { id: string; name: Localized; sortOrder?: number };
  type ApiItemLite = { id: string };
  type ApiCompositionLite = {
    categories?: ApiCategoryLite[];
    items?: ApiItemLite[];
    lastChange?: string;
  };
  type ApiAvailabilityLite = {
    items?: { itemId: string; stock?: number }[];
  };

  const id = encodeURIComponent(restaurantId);
  const [composition, availability] = await Promise.all([
    deleverFetch(`/menu/${id}/composition`, {
      acceptType: "application/vnd.eats.menu.composition.v2+json",
    }) as Promise<ApiCompositionLite>,
    deleverFetch(`/menu/${id}/availability`, {
      acceptType: "application/vnd.eats.menu.availability.v2+json",
    }) as Promise<ApiAvailabilityLite>,
  ]);

  const itemIds = new Set((composition?.items || []).map((i) => i.id));
  let unavailable = 0;
  for (const it of availability?.items || []) {
    if (!itemIds.has(it.itemId)) continue;
    if ((it.stock ?? 0) <= 0) unavailable += 1;
  }

  const categories = (composition?.categories || []).slice();
  categories.sort(
    (a, b) =>
      (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
  );

  return {
    categories_count: categories.length,
    items_count: composition?.items?.length ?? 0,
    unavailable_count: unavailable,
    category_names: categories.slice(0, 3).map((c) => pickLang(c.name, language)),
    last_change: composition?.lastChange || "",
  };
}

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
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
    details_available: true,
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

  // Spec: GET /v1/custom-integration/menu/{restaurantId}/composition
  //   Content-Type: application/vnd.eats.menu.composition.v2+json
  //   → CustomIntegrationMenuCompositionV2
  type ApiImage = { url?: string; updatedAt?: string; hash?: string };
  type ApiCategory = {
    id: string;
    parentId?: string;
    name: Localized;
    sortOrder?: number;
    /**
     * Per Delever V2 docs, categories carry an array of schedule keys that
     * reference entries in the top-level `schedules` map.
     */
    schedules?: string[];
    images?: ApiImage[];
  };
  type ApiModifier = {
    id: string;
    name: Localized;
    price?: number;
    minAmount: number;
    maxAmount: number;
  };
  type ApiModifierGroup = {
    id: string;
    name: Localized;
    minSelectedModifiers: number;
    maxSelectedModifiers: number;
    sortOrder?: number;
    modifiers?: ApiModifier[];
  };
  type ApiItem = {
    id: string;
    categoryId?: string;
    name: Localized;
    description?: string;
    price: number;
    measure?: number;
    measureUnit?: string;
    sortOrder?: number;
    modifierGroups?: ApiModifierGroup[];
    images?: ApiImage[];
  };
  type ApiSchedule = { from: string; till: string; weekdays?: string[] };
  type ApiComposition = {
    categories?: ApiCategory[];
    items?: ApiItem[];
    lastChange?: string;
    /** Map: schedule key → list of slot objects. */
    schedules?: Record<string, ApiSchedule[]>;
  };
  // Spec: GET /v1/custom-integration/menu/{restaurantId}/availability
  //   → MenuAvailabilityV2 = { items:[{itemId,stock}], modifiers:[{modifierId,stock}] }
  type ApiAvailability = {
    items?: { itemId: string; stock?: number }[];
    modifiers?: { modifierId: string; stock?: number }[];
  };

  const restaurantId = encodeURIComponent(params.restaurant_id);
  const [composition, availability] = await Promise.all([
    deleverFetch(`/menu/${restaurantId}/composition`, {
      acceptType: "application/vnd.eats.menu.composition.v2+json",
    }) as Promise<ApiComposition>,
    deleverFetch(`/menu/${restaurantId}/availability`, {
      acceptType: "application/vnd.eats.menu.availability.v2+json",
    }) as Promise<ApiAvailability>,
  ]);

  // Convention from Delever spec: an entry is unavailable when an availability
  // record exists with `stock <= 0`; missing entries default to "in stock".
  const itemStock = new Map<string, number>();
  for (const it of availability?.items || []) {
    itemStock.set(it.itemId, it.stock ?? 0);
  }
  const modifierStock = new Map<string, number>();
  for (const m of availability?.modifiers || []) {
    modifierStock.set(m.modifierId, m.stock ?? 0);
  }
  const isItemAvailable = (id: string) =>
    !itemStock.has(id) || (itemStock.get(id) ?? 0) > 0;
  const isModifierAvailable = (id: string) =>
    !modifierStock.has(id) || (modifierStock.get(id) ?? 0) > 0;

  const categoryMap = new Map<string, string>();
  for (const c of composition?.categories || []) {
    categoryMap.set(c.id, pickLang(c.name, lang));
  }

  const itemsPerCategory = new Map<string, number>();
  for (const it of composition?.items || []) {
    const cid = it.categoryId || "";
    itemsPerCategory.set(cid, (itemsPerCategory.get(cid) || 0) + 1);
  }

  const schedulesMap = composition?.schedules || {};
  const resolveSchedules = (keys?: string[]): ScheduleSlot[] => {
    if (!keys?.length) return [];
    const slots: ScheduleSlot[] = [];
    for (const k of keys) {
      const list = schedulesMap[k];
      if (!list) continue;
      for (const s of list) {
        slots.push({
          from: s.from,
          till: s.till,
          weekdays: s.weekdays || [],
        });
      }
    }
    return slots;
  };

  const categories: MenuCategory[] = (composition?.categories || []).map(
    (c) => ({
      id: c.id,
      name: pickLang(c.name, lang),
      parent_id: c.parentId,
      sort_order: c.sortOrder,
      item_count: itemsPerCategory.get(c.id) || 0,
      schedules: resolveSchedules(c.schedules),
      image_url: c.images?.[0]?.url,
    })
  );
  categories.sort(
    (a, b) =>
      (a.sort_order ?? Number.MAX_SAFE_INTEGER) -
        (b.sort_order ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name)
  );

  const items: MenuItem[] = (composition?.items || []).map((it) => {
    const groups = it.modifierGroups || [];
    const stock = itemStock.has(it.id) ? itemStock.get(it.id) : undefined;
    return {
      id: it.id,
      category: it.categoryId ? categoryMap.get(it.categoryId) || "" : "",
      category_id: it.categoryId || "",
      name: pickLang(it.name, lang),
      description: it.description || "",
      price: it.price,
      measure: it.measure ?? 0,
      measure_unit: it.measureUnit || "",
      available: isItemAvailable(it.id),
      stock,
      image_url: it.images?.[0]?.url,
      sort_order: it.sortOrder,
      modifiers: groups.map((g) => ({
        id: g.id,
        name: pickLang(g.name, lang),
        min: g.minSelectedModifiers,
        max: g.maxSelectedModifiers,
        options: (g.modifiers || [])
          .filter((o) => isModifierAvailable(o.id))
          .map((o) => ({
            id: o.id,
            name: pickLang(o.name, lang),
            price: o.price ?? 0,
            min_amount: o.minAmount,
            max_amount: o.maxAmount,
          })),
      })),
    };
  });
  items.sort(
    (a, b) =>
      (a.sort_order ?? Number.MAX_SAFE_INTEGER) -
        (b.sort_order ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name)
  );

  const availableCount = items.filter((i) => i.available).length;

  return {
    restaurant_id: params.restaurant_id,
    language: lang,
    last_change: composition?.lastChange || new Date().toISOString(),
    categories,
    items,
    summary: {
      categories_count: categories.length,
      items_count: items.length,
      available_count: availableCount,
      unavailable_count: items.length - availableCount,
    },
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
    category_id: it.categoryId,
    name: pickLang(it.name, lang),
    description: pickLang(it.description, lang),
    price: it.price,
    measure: it.weight,
    measure_unit: "г",
    available: !stockMap.has(it.id) || (stockMap.get(it.id) ?? 0) > 0,
    stock: stockMap.has(it.id) ? stockMap.get(it.id) : undefined,
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
  const itemsPerCategoryMock = new Map<string, number>();
  for (const it of menu.items) {
    itemsPerCategoryMock.set(
      it.categoryId,
      (itemsPerCategoryMock.get(it.categoryId) || 0) + 1
    );
  }
  const categories: MenuCategory[] = menu.categories.map((c) => ({
    id: c.id,
    name: pickLang(c.name, lang),
    item_count: itemsPerCategoryMock.get(c.id) || 0,
    schedules: [],
  }));
  const availableCount = items.filter((i) => i.available).length;
  return {
    restaurant_id: menu.restaurantId,
    language: lang,
    last_change: menu.lastChange,
    categories,
    items,
    summary: {
      categories_count: categories.length,
      items_count: items.length,
      available_count: availableCount,
      unavailable_count: items.length - availableCount,
    },
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

  // Delever V2 requires `price` and `name` per item (and per modifier) in
  // the order body — those aren't in our MCP input, so we resolve them by
  // fetching the menu first. This also serves as a sanity check (item exists,
  // modifier belongs to the right group, etc.).
  const menu = await getMenu({
    restaurant_id: input.restaurant_id,
    language: "ru",
  });
  const itemsById = new Map(menu.items.map((it) => [it.id, it]));

  const orderItems = input.items.map((line) => {
    const dish = itemsById.get(line.item_id);
    if (!dish) {
      throw new Error(
        `Item ${line.item_id} is not on the menu of ${input.restaurant_id}.`
      );
    }
    if (!dish.available) {
      throw new Error(
        `Item ${line.item_id} (${dish.name}) is currently on stop.`
      );
    }

    // Build a lookup that knows which group each option belongs to so we
    // can validate the per-group min/max selection rules before the order
    // is forwarded to Delever / iiko (which would otherwise reject it
    // with an opaque "invalid group amount" error).
    const optionToGroup = new Map<
      string,
      { groupId: string; groupName: string; price: number; name: string }
    >();
    for (const g of dish.modifiers) {
      for (const o of g.options) {
        optionToGroup.set(o.id, {
          groupId: g.id,
          groupName: g.name,
          name: o.name,
          price: o.price,
        });
      }
    }

    const requestedIds = line.modifier_ids || [];
    const modifications: { id: string; name: string; quantity: number; price: number }[] = [];
    const perGroupCount = new Map<string, number>();
    for (const id of requestedIds) {
      const opt = optionToGroup.get(id);
      if (!opt) {
        throw new Error(
          `Modifier ${id} is not available for ${line.item_id} (${dish.name}). ` +
            `Look up valid modifier ids in get_menu output: items[].modifiers[].options[].id.`
        );
      }
      modifications.push({ id, name: opt.name, quantity: 1, price: opt.price });
      perGroupCount.set(opt.groupId, (perGroupCount.get(opt.groupId) || 0) + 1);
    }

    // Enforce min/max per modifier group. iiko rejects these with a generic
    // 400 — we mirror the validation here so the caller (Claude/UI/etc.)
    // gets a clear, actionable message before any side effects occur.
    for (const g of dish.modifiers) {
      const picked = perGroupCount.get(g.id) || 0;
      if (picked < g.min) {
        const optionsHint = g.options
          .map((o) => `${o.name} (${o.id})`)
          .join(", ");
        throw new Error(
          `Modifier group "${g.name}" on item "${dish.name}" requires ` +
            `at least ${g.min} option(s) — you selected ${picked}. ` +
            `Pick one from: ${optionsHint || "(no options available)"}. ` +
            `Group id: ${g.id}.`
        );
      }
      if (picked > g.max) {
        throw new Error(
          `Modifier group "${g.name}" on item "${dish.name}" allows at most ` +
            `${g.max} option(s) — you selected ${picked}.`
        );
      }
    }

    const modifiersTotal = modifications.reduce((s, m) => s + m.price, 0);
    // Per spec: "price (со стоимостью модификаций)".
    const linePrice = dish.price + modifiersTotal;
    return {
      id: dish.id,
      name: dish.name,
      quantity: line.quantity,
      price: linePrice,
      modifications,
    };
  });

  const itemsCost = orderItems.reduce(
    (s, it) => s + it.price * it.quantity,
    0
  );

  const body = {
    discriminator: "aggregator",
    eatsId: `mcp_${Date.now()}`,
    restaurantId: input.restaurant_id,
    deliveryInfo: {
      clientName: input.delivery.name,
      phoneNumber: input.delivery.phone,
      deliveryAddress: {
        full: input.delivery.address,
        // Spec types lat/long as strings.
        latitude: String(input.delivery.lat),
        longitude: String(input.delivery.lng),
      },
    },
    paymentInfo: {
      itemsCost,
      paymentType: input.payment,
    },
    items: orderItems,
    ...(input.comment ? { comment: input.comment } : {}),
  };

  const result = (await deleverFetch("/order", {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.eats.order.v2+json",
    },
    body: JSON.stringify(body),
  })) as { result?: string; orderId?: string };

  // Per spec only `result` is required; `orderId` is optional. Fall back to
  // our outgoing `eatsId` so callers always have a stable identifier they
  // can use to query order status via Delever's `eatsId`-aware endpoints.
  return {
    order_id: result.orderId || body.eatsId,
    total: itemsCost,
    status: "ACCEPTED",
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

  // Spec: GET /v1/custom-integration/order/{orderId}/status
  // → GetOrderByStatus = { status, comment?, updatedAt? }
  const result = (await deleverFetch(
    `/order/${encodeURIComponent(order_id)}/status`
  )) as { status?: string; comment?: string; updatedAt?: string };

  return {
    order_id,
    status: (result.status as OrderStatus) ?? "ACCEPTED",
    updated_at: result.updatedAt || new Date().toISOString(),
    ...(result.comment ? { comment: result.comment } : {}),
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

  // Spec: DELETE /v1/custom-integration/order/{orderId}, body: { comment? }
  await deleverFetch(`/order/${encodeURIComponent(order_id)}`, {
    method: "DELETE",
    body: JSON.stringify({ comment: reason }),
  });
  return { order_id, status: "CANCELLED" };
}

/* ---------------------------------------------------------------------- */
/* Extended order operations                                              */
/* ---------------------------------------------------------------------- */

export interface OrderItemDetails {
  id: string;
  name?: string;
  quantity: number;
  price: number;
}

export interface OrderDetails {
  order_id: string;
  platform?: string;
  delivery_type?: string;
  eats_id?: string;
  restaurant_id: string;
  client_name?: string;
  phone?: string;
  delivery_address?: string;
  payment_type?: string;
  items_cost?: number;
  delivery_fee?: number;
  persons?: number;
  comment?: string;
  items: OrderItemDetails[];
}

/** Spec: GET /v1/custom-integration/order/{orderId} */
export async function getOrder(order_id: string): Promise<OrderDetails> {
  if (isMockMode()) {
    const record = mockOrders.get(order_id);
    if (!record) {
      throw new Error(
        `Order ${order_id} not found. (Mock storage is reset on cold start.)`
      );
    }
    return {
      order_id: record.order_id,
      restaurant_id: record.restaurant_id,
      client_name: record.delivery.name,
      phone: record.delivery.phone,
      delivery_address: record.delivery.address,
      payment_type: record.payment,
      items_cost: record.total,
      comment: record.comment,
      items: record.items.map((line) => ({
        id: line.item_id,
        quantity: line.quantity,
        price: 0, // mock store doesn't keep per-line resolved price
      })),
    };
  }

  type ApiOrderItem = {
    id?: string;
    name?: string;
    quantity?: number;
    price?: number;
  };
  type ApiOrderResponse = {
    platform?: string;
    discriminator?: string;
    eatsId?: string;
    restaurantId?: string;
    deliveryInfo?: {
      clientName?: string;
      phoneNumber?: string;
      deliveryAddress?: { full?: string };
    };
    paymentInfo?: {
      itemsCost?: number;
      paymentType?: string;
      deliveryFee?: number;
    };
    persons?: number;
    comment?: string;
    items?: ApiOrderItem[];
  };

  // Spec: response is application/vnd.eats.order.v2+json (note the v2 vendor
  // type — same family as createOrder).
  const result = (await deleverFetch(
    `/order/${encodeURIComponent(order_id)}`,
    { acceptType: "application/vnd.eats.order.v2+json" }
  )) as ApiOrderResponse;

  return {
    order_id,
    platform: result.platform,
    delivery_type: result.discriminator,
    eats_id: result.eatsId,
    restaurant_id: result.restaurantId || "",
    client_name: result.deliveryInfo?.clientName,
    phone: result.deliveryInfo?.phoneNumber,
    delivery_address: result.deliveryInfo?.deliveryAddress?.full,
    payment_type: result.paymentInfo?.paymentType,
    items_cost: result.paymentInfo?.itemsCost,
    delivery_fee: result.paymentInfo?.deliveryFee,
    persons: result.persons,
    comment: result.comment,
    items: (result.items || []).map((it) => ({
      id: it.id || "",
      name: it.name,
      quantity: it.quantity ?? 0,
      price: it.price ?? 0,
    })),
  };
}

export type UpdateOrderStatus =
  | "DELIVERED"
  | "CANCELLED"
  | "TAKEN_BY_COURIER";

/** Spec: PUT /v1/custom-integration/order/{orderId}/status */
export async function updateOrderStatus(
  order_id: string,
  status: UpdateOrderStatus,
  comment?: string
): Promise<{ order_id: string; status: UpdateOrderStatus }> {
  if (isMockMode()) {
    const record = mockOrders.get(order_id);
    if (!record) {
      throw new Error(
        `Order ${order_id} not found. (Mock storage is reset on cold start.)`
      );
    }
    record.status = status as OrderStatus;
    record.updated_at = new Date().toISOString();
    return { order_id, status };
  }

  await deleverFetch(`/order/${encodeURIComponent(order_id)}/status`, {
    method: "PUT",
    body: JSON.stringify(comment ? { status, comment } : { status }),
  });
  return { order_id, status };
}

export interface PromoItem {
  /** Menu item id (system id of the dish). */
  id: string;
  /** Promo id this item participates in. */
  promo_id: string;
}

/** Spec: GET /v1/custom-integration/menu/{restaurantId}/promos */
export async function listPromoItems(restaurant_id: string): Promise<{
  restaurant_id: string;
  items: PromoItem[];
}> {
  if (isMockMode()) {
    // Mocks don't model promotions yet — return an empty list with a note
    // so the LLM can still call the tool without error.
    return { restaurant_id, items: [] };
  }

  type ApiPromos = {
    promoItems?: { id: string; promoId: string }[];
  };
  const result = (await deleverFetch(
    `/menu/${encodeURIComponent(restaurant_id)}/promos`
  )) as ApiPromos;

  return {
    restaurant_id,
    items: (result.promoItems || []).map((p) => ({
      id: p.id,
      promo_id: p.promoId,
    })),
  };
}
