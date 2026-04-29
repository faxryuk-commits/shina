"use client";

/**
 * One-page ordering UX, mobile-first. Three screens, switched via
 * `step` state — `branches` → `menu` → `cart` (which also hosts the
 * checkout form). Cart is held in component state (no server-side
 * persistence). Geolocation is requested up front to:
 *   1) sort branches by distance from the user;
 *   2) pre-fill delivery lat/lng so the form only needs the address.
 */

import { useEffect, useMemo, useState } from "react";
import type { RestaurantSummary } from "@/lib/deleverClient";

interface MenuModifierOption {
  id: string;
  name: string;
  price: number;
  min_amount?: number;
  max_amount?: number;
}
interface MenuModifier {
  id: string;
  name: string;
  min: number;
  max: number;
  options: MenuModifierOption[];
}
interface MenuItem {
  id: string;
  category: string;
  category_id: string;
  name: string;
  description: string;
  price: number;
  measure: number;
  measure_unit: string;
  available: boolean;
  stock?: number;
  image_url?: string;
  modifiers: MenuModifier[];
  sort_order?: number;
}
interface MenuCategory {
  id: string;
  name: string;
  item_count: number;
  sort_order?: number;
  image_url?: string;
}
interface MenuResult {
  restaurant_id: string;
  language: string;
  last_change: string;
  categories: MenuCategory[];
  items: MenuItem[];
  summary: {
    categories_count: number;
    items_count: number;
    available_count: number;
    unavailable_count: number;
  };
}

interface CartLine {
  id: string;
  item_id: string;
  name: string;
  price: number;
  quantity: number;
  modifier_ids: string[];
  modifier_names: string[];
}

type Step = "branches" | "menu" | "cart";
type Geo =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "denied"; message: string }
  | { state: "ok"; lat: number; lng: number };

interface Props {
  branches: RestaurantSummary[];
  loadError: string | null;
}

export default function OrderApp({ branches, loadError }: Props) {
  const [step, setStep] = useState<Step>("branches");
  const [geo, setGeo] = useState<Geo>({ state: "idle" });
  const [activeBranch, setActiveBranch] = useState<RestaurantSummary | null>(null);
  const [menu, setMenu] = useState<MenuResult | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);

  /* ------------------------- geolocation request ----------------------- */

  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGeo({ state: "denied", message: "Геолокация не поддерживается браузером." });
      return;
    }
    setGeo({ state: "loading" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ state: "ok", lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setGeo({ state: "denied", message: err.message }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  }, []);

  /* --------------------------- sorted branches ------------------------- */

  const sortedBranches = useMemo(() => {
    if (geo.state !== "ok") return branches;
    return [...branches].sort((a, b) => {
      const da = haversineKm(geo.lat, geo.lng, a.lat, a.lng);
      const db = haversineKm(geo.lat, geo.lng, b.lat, b.lng);
      return da - db;
    });
  }, [branches, geo]);

  /* --------------------------- menu fetching --------------------------- */

  async function openBranch(branch: RestaurantSummary) {
    setActiveBranch(branch);
    setStep("menu");
    setMenu(null);
    setMenuError(null);
    setMenuLoading(true);
    try {
      const res = await fetch(`/api/menu?restaurant_id=${branch.id}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMenu(data.menu);
    } catch (err) {
      setMenuError(err instanceof Error ? err.message : String(err));
    } finally {
      setMenuLoading(false);
    }
  }

  /* --------------------------- cart helpers ---------------------------- */

  function addToCart(item: MenuItem, modifier_ids: string[], modifier_names: string[]) {
    const lineId = `${item.id}|${modifier_ids.join(",")}|${Date.now()}`;
    const modPrice = modifier_ids.reduce((s, id) => {
      for (const g of item.modifiers) {
        const opt = g.options.find((o) => o.id === id);
        if (opt) return s + opt.price;
      }
      return s;
    }, 0);
    setCart((prev) => [
      ...prev,
      {
        id: lineId,
        item_id: item.id,
        name: item.name,
        price: item.price + modPrice,
        quantity: 1,
        modifier_ids,
        modifier_names,
      },
    ]);
  }

  function changeQty(lineId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.id === lineId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function removeLine(lineId: string) {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
  }

  const cartTotal = cart.reduce((s, l) => s + l.price * l.quantity, 0);

  /* ---------------------------- render --------------------------------- */

  if (loadError) {
    return (
      <Centered>
        <ErrorBox text={`Не удалось загрузить список филиалов: ${loadError}`} />
      </Centered>
    );
  }

  if (branches.length === 0) {
    return (
      <Centered>
        <Empty>
          Сейчас нет филиалов с активным меню. Зайдите чуть позже.
        </Empty>
      </Centered>
    );
  }

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "16px 16px 100px",
        lineHeight: 1.5,
      }}
    >
      <Header
        step={step}
        branchName={activeBranch?.name}
        onBack={() => {
          if (step === "menu") setStep("branches");
          else if (step === "cart") setStep("menu");
        }}
        cartCount={cart.reduce((s, l) => s + l.quantity, 0)}
        onOpenCart={() => setStep("cart")}
      />

      {step === "branches" && (
        <BranchList branches={sortedBranches} geo={geo} onPick={openBranch} />
      )}

      {step === "menu" && activeBranch && (
        <MenuView
          branch={activeBranch}
          menu={menu}
          loading={menuLoading}
          error={menuError}
          cart={cart}
          onAdd={addToCart}
          onChangeQty={changeQty}
          onCheckout={() => setStep("cart")}
        />
      )}

      {step === "cart" && activeBranch && (
        <CartView
          branch={activeBranch}
          cart={cart}
          total={cartTotal}
          geo={geo}
          onChangeQty={changeQty}
          onRemove={removeLine}
          onPlaced={() => {
            setCart([]);
            setStep("branches");
            setActiveBranch(null);
            setMenu(null);
          }}
        />
      )}

      {step !== "cart" && cart.length > 0 && (
        <FloatingCartBar
          count={cart.reduce((s, l) => s + l.quantity, 0)}
          total={cartTotal}
          onClick={() => setStep("cart")}
        />
      )}
    </main>
  );
}

/* ============================ subcomponents ============================ */

function Header({
  step,
  branchName,
  cartCount,
  onBack,
  onOpenCart,
}: {
  step: Step;
  branchName?: string;
  cartCount: number;
  onBack: () => void;
  onOpenCart: () => void;
}) {
  const title =
    step === "branches" ? "Выберите филиал"
    : step === "menu" ? branchName || "Меню"
    : "Корзина";
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 0 16px",
        borderBottom: "1px solid #1f1f1f",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {step !== "branches" && (
          <button
            onClick={onBack}
            style={{
              border: "1px solid #2a2a2a",
              background: "#111",
              color: "#ededed",
              borderRadius: 999,
              width: 34,
              height: 34,
              cursor: "pointer",
              fontSize: 16,
              flexShrink: 0,
            }}
            aria-label="Назад"
          >
            ‹
          </button>
        )}
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </h1>
      </div>
      {cartCount > 0 && step !== "cart" && (
        <button
          onClick={onOpenCart}
          style={{
            border: "1px solid #10b981",
            background: "#10b98122",
            color: "#10b981",
            borderRadius: 999,
            padding: "6px 14px",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          Корзина · {cartCount}
        </button>
      )}
    </header>
  );
}

function BranchList({
  branches,
  geo,
  onPick,
}: {
  branches: RestaurantSummary[];
  geo: Geo;
  onPick: (b: RestaurantSummary) => void;
}) {
  return (
    <>
      <GeoBadge geo={geo} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {branches.map((b) => {
          const distance =
            geo.state === "ok"
              ? haversineKm(geo.lat, geo.lng, b.lat, b.lng)
              : null;
          const stats = b.menu_stats;
          return (
            <button
              key={b.id}
              onClick={() => onPick(b)}
              style={{
                textAlign: "left",
                border: "1px solid #1f1f1f",
                background: "#111",
                color: "inherit",
                borderRadius: 12,
                padding: 14,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 10,
                  marginBottom: 4,
                }}
              >
                <strong style={{ fontSize: 15 }}>{b.name}</strong>
                {distance !== null && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "#10b981",
                      flexShrink: 0,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {distance < 1
                      ? `${Math.round(distance * 1000)} м`
                      : `${distance.toFixed(1)} км`}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                {b.address || "—"}
              </div>
              {stats && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#737373",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {stats.items_count} позиций
                  {stats.unavailable_count > 0 &&
                    ` · ${stats.unavailable_count} на стопе`}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function GeoBadge({ geo }: { geo: Geo }) {
  let text = "";
  let color = "#737373";
  if (geo.state === "loading") text = "Запрашиваем геолокацию…";
  else if (geo.state === "denied") {
    text = "Без геолокации — филиалы показаны без сортировки по расстоянию.";
  } else if (geo.state === "ok") {
    text = "Филиалы отсортированы по расстоянию от вас.";
    color = "#10b981";
  }
  if (!text) return null;
  return (
    <div
      style={{
        fontSize: 12,
        color,
        marginBottom: 12,
        padding: "8px 12px",
        background: `${color}1a`,
        border: `1px solid ${color}55`,
        borderRadius: 10,
      }}
    >
      {text}
    </div>
  );
}

function MenuView({
  branch,
  menu,
  loading,
  error,
  cart,
  onAdd,
  onChangeQty,
  onCheckout,
}: {
  branch: RestaurantSummary;
  menu: MenuResult | null;
  loading: boolean;
  error: string | null;
  cart: CartLine[];
  onAdd: (item: MenuItem, modifierIds: string[], modifierNames: string[]) => void;
  onChangeQty: (lineId: string, delta: number) => void;
  onCheckout: () => void;
}) {
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  if (loading) return <Empty>Загружаем меню…</Empty>;
  if (error) return <ErrorBox text={`Меню не загрузилось: ${error}`} />;
  if (!menu) return <Empty>Меню недоступно.</Empty>;

  return (
    <>
      <p style={{ opacity: 0.7, fontSize: 13, marginTop: 0 }}>
        {branch.address}
      </p>
      {menu.categories.map((cat) => {
        const items = menu.items.filter((it) => it.category_id === cat.id);
        if (items.length === 0) return null;
        return (
          <section key={cat.id} style={{ marginBottom: 24 }}>
            <h2
              style={{
                fontSize: 15,
                margin: "16px 0 8px",
                color: "#a3a3a3",
                textTransform: "uppercase",
                letterSpacing: 0.6,
              }}
            >
              {cat.name}
              <span style={{ marginLeft: 8, color: "#525252", fontWeight: 400 }}>
                {items.length}
              </span>
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((it) => {
                const inCart = cart.find(
                  (l) => l.item_id === it.id && l.modifier_ids.length === 0
                );
                return (
                  <ItemRow
                    key={it.id}
                    item={it}
                    inCartLine={inCart}
                    onClick={() => {
                      if (it.modifiers.length > 0) {
                        setOpenItem(it);
                      } else if (it.available) {
                        onAdd(it, [], []);
                      }
                    }}
                    onChangeQty={onChangeQty}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
      {openItem && (
        <ItemModal
          item={openItem}
          onClose={() => setOpenItem(null)}
          onAdd={(modIds, modNames) => {
            onAdd(openItem, modIds, modNames);
            setOpenItem(null);
          }}
        />
      )}
      {cart.length > 0 && (
        <button
          onClick={onCheckout}
          style={primaryButton}
        >
          К оформлению →
        </button>
      )}
    </>
  );
}

function ItemRow({
  item,
  inCartLine,
  onClick,
  onChangeQty,
}: {
  item: MenuItem;
  inCartLine?: CartLine;
  onClick: () => void;
  onChangeQty: (lineId: string, delta: number) => void;
}) {
  const stopped = !item.available;
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: 12,
        border: `1px solid ${stopped ? "#5c1a1a" : "#1f1f1f"}`,
        background: stopped ? "#1d0d0d" : "#0e0e0e",
        borderRadius: 12,
        opacity: stopped ? 0.7 : 1,
      }}
    >
      {item.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image_url}
          alt=""
          style={{
            width: 72,
            height: 72,
            objectFit: "cover",
            borderRadius: 8,
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
          {item.name}
        </div>
        {item.description && (
          <div
            style={{
              fontSize: 12,
              opacity: 0.6,
              marginBottom: 6,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.description}
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: stopped ? "#9a4a4a" : "#10b981",
              textDecoration: stopped ? "line-through" : undefined,
            }}
          >
            {formatPrice(item.price)}
          </span>
          {stopped ? (
            <span style={{ fontSize: 11, color: "#ef4444" }}>На стопе</span>
          ) : inCartLine && item.modifiers.length === 0 ? (
            <Stepper
              quantity={inCartLine.quantity}
              onMinus={() => onChangeQty(inCartLine.id, -1)}
              onPlus={() => onChangeQty(inCartLine.id, +1)}
            />
          ) : (
            <button
              onClick={onClick}
              style={{
                border: "1px solid #10b981",
                background: "#10b98122",
                color: "#10b981",
                borderRadius: 999,
                padding: "4px 14px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {item.modifiers.length > 0 ? "Выбрать" : "+"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({
  quantity,
  onMinus,
  onPlus,
}: {
  quantity: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0,
        border: "1px solid #10b981",
        borderRadius: 999,
        overflow: "hidden",
      }}
    >
      <StepBtn onClick={onMinus}>−</StepBtn>
      <span
        style={{
          padding: "0 10px",
          minWidth: 22,
          textAlign: "center",
          color: "#10b981",
          fontWeight: 600,
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {quantity}
      </span>
      <StepBtn onClick={onPlus}>+</StepBtn>
    </div>
  );
}

function StepBtn({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        color: "#10b981",
        border: "none",
        width: 28,
        height: 28,
        cursor: "pointer",
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

function ItemModal({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (modifierIds: string[], modifierNames: string[]) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  function toggle(groupId: string, optionId: string, max: number) {
    setPicked((prev) => {
      const cur = prev[groupId] || [];
      if (cur.includes(optionId)) {
        return { ...prev, [groupId]: cur.filter((x) => x !== optionId) };
      }
      if (max === 1) return { ...prev, [groupId]: [optionId] };
      if (cur.length >= max) return prev;
      return { ...prev, [groupId]: [...cur, optionId] };
    });
  }

  const validation = item.modifiers
    .map((g) => {
      const cur = picked[g.id] || [];
      if (cur.length < g.min) {
        return `«${g.name}»: выберите минимум ${g.min}`;
      }
      return null;
    })
    .filter(Boolean) as string[];
  const canAdd = validation.length === 0;

  const totalAddon = Object.entries(picked).reduce((s, [, ids]) => {
    return (
      s +
      ids.reduce((acc, id) => {
        for (const g of item.modifiers) {
          const opt = g.options.find((o) => o.id === id);
          if (opt) return acc + opt.price;
        }
        return acc;
      }, 0)
    );
  }, 0);

  function submit() {
    if (!canAdd) return;
    const allIds: string[] = [];
    const allNames: string[] = [];
    for (const g of item.modifiers) {
      for (const id of picked[g.id] || []) {
        const opt = g.options.find((o) => o.id === id);
        if (opt) {
          allIds.push(id);
          allNames.push(opt.name);
        }
      }
    }
    onAdd(allIds, allNames);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "#000a",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0a0a0a",
          border: "1px solid #1f1f1f",
          borderRadius: "16px 16px 0 0",
          maxWidth: 720,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "20px 16px 100px",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>{item.name}</h2>
        {item.description && (
          <p style={{ margin: "6px 0 16px", opacity: 0.7, fontSize: 13 }}>
            {item.description}
          </p>
        )}
        {item.modifiers.map((g) => (
          <section key={g.id} style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>{g.name}</strong>
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  color: g.min > 0 ? "#f59e0b" : "#737373",
                }}
              >
                {g.min === g.max
                  ? g.min === 1 ? "обязательно, 1" : `обязательно, ${g.min}`
                  : g.min === 0
                    ? `до ${g.max}`
                    : `от ${g.min} до ${g.max}`}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {g.options.map((o) => {
                const isPicked = (picked[g.id] || []).includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(g.id, o.id, g.max)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      border: `1px solid ${isPicked ? "#10b981" : "#2a2a2a"}`,
                      background: isPicked ? "#10b98122" : "#111",
                      color: "inherit",
                      borderRadius: 10,
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 14,
                    }}
                  >
                    <span>{o.name}</span>
                    <span style={{ fontSize: 13, opacity: 0.8 }}>
                      {o.price > 0 ? `+ ${formatPrice(o.price)}` : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        <div
          style={{
            position: "sticky",
            bottom: 0,
            background: "#0a0a0a",
            paddingTop: 12,
            paddingBottom: 12,
            borderTop: "1px solid #1f1f1f",
            marginTop: 8,
          }}
        >
          {validation.length > 0 && (
            <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 8 }}>
              {validation.join(" · ")}
            </div>
          )}
          <button
            onClick={submit}
            disabled={!canAdd}
            style={{
              ...primaryButton,
              opacity: canAdd ? 1 : 0.4,
              cursor: canAdd ? "pointer" : "not-allowed",
              marginTop: 0,
            }}
          >
            Добавить — {formatPrice(item.price + totalAddon)}
          </button>
        </div>
      </div>
    </div>
  );
}

function CartView({
  branch,
  cart,
  total,
  geo,
  onChangeQty,
  onRemove,
  onPlaced,
}: {
  branch: RestaurantSummary;
  cart: CartLine[];
  total: number;
  geo: Geo;
  onChangeQty: (lineId: string, delta: number) => void;
  onRemove: (lineId: string) => void;
  onPlaced: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+998");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [payment, setPayment] = useState<"CARD" | "CASH">("CASH");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; order_id: string; total: number }
    | { ok: false; error: string }
    | null
  >(null);

  const hasGeo = geo.state === "ok";
  const canSubmit =
    !submitting &&
    name.trim().length > 1 &&
    /^\+998\d{9}$/.test(phone.trim()) &&
    address.trim().length > 4 &&
    hasGeo &&
    cart.length > 0;

  async function submit() {
    if (!canSubmit || geo.state !== "ok") return;
    setSubmitting(true);
    setResult(null);
    try {
      const items = cart.flatMap((l) =>
        Array.from({ length: l.quantity }).map(() => ({
          item_id: l.item_id,
          quantity: 1,
          modifier_ids: l.modifier_ids,
        }))
      );
      // Group same lines for nicer payload
      const grouped = new Map<string, { item_id: string; quantity: number; modifier_ids: string[] }>();
      for (const l of cart) {
        const key = `${l.item_id}|${l.modifier_ids.join(",")}`;
        const ex = grouped.get(key);
        if (ex) ex.quantity += l.quantity;
        else grouped.set(key, { item_id: l.item_id, quantity: l.quantity, modifier_ids: l.modifier_ids });
      }

      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_id: branch.id,
          items: Array.from(grouped.values()),
          delivery: {
            name: name.trim(),
            phone: phone.trim(),
            address: address.trim(),
            lat: geo.lat,
            lng: geo.lng,
          },
          payment,
          comment: comment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({ ok: true, order_id: data.order.order_id, total: data.order.total });
      } else {
        setResult({ ok: false, error: data.error || "Не удалось оформить" });
      }
      void items;
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.ok) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "40px 16px",
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
        <h2 style={{ margin: "0 0 8px" }}>Заказ принят!</h2>
        <p style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>
          Сумма: <strong>{formatPrice(result.total)}</strong>
        </p>
        <p style={{ opacity: 0.5, fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          Order id: {result.order_id}
        </p>
        <p style={{ opacity: 0.65, fontSize: 13, margin: "16px 0" }}>
          С вами скоро свяжется ресторан, чтобы подтвердить детали.
        </p>
        <button onClick={onPlaced} style={primaryButton}>
          Сделать ещё один заказ
        </button>
      </div>
    );
  }

  return (
    <>
      <p style={{ opacity: 0.65, fontSize: 13, margin: "0 0 12px" }}>
        Заказ из <strong>{branch.name}</strong>
      </p>
      <section style={{ marginBottom: 20 }}>
        {cart.length === 0 ? (
          <Empty>Корзина пуста.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cart.map((l) => (
              <div
                key={l.id}
                style={{
                  border: "1px solid #1f1f1f",
                  background: "#0e0e0e",
                  borderRadius: 12,
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{l.name}</div>
                  {l.modifier_names.length > 0 && (
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                      + {l.modifier_names.join(", ")}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 12,
                      color: "#10b981",
                      marginTop: 4,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatPrice(l.price)} × {l.quantity} = {formatPrice(l.price * l.quantity)}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                  <Stepper
                    quantity={l.quantity}
                    onMinus={() => onChangeQty(l.id, -1)}
                    onPlus={() => onChangeQty(l.id, +1)}
                  />
                  <button
                    onClick={() => onRemove(l.id)}
                    style={{
                      background: "transparent",
                      color: "#737373",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 11,
                      padding: 0,
                    }}
                  >
                    удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginBottom: 20 }}>
        <Field label="Ваше имя">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            placeholder="Например, Фахриддин"
          />
        </Field>
        <Field label="Телефон" hint="В формате +998XXXXXXXXX">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={inputStyle}
            inputMode="tel"
          />
        </Field>
        <Field
          label="Адрес доставки"
          hint={
            geo.state === "ok"
              ? "Координаты подставлены автоматически из вашей геолокации."
              : "Геолокация недоступна — менеджер уточнит точку при звонке."
          }
        >
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            style={inputStyle}
            placeholder="Улица, дом, подъезд, этаж"
          />
        </Field>
        <Field label="Комментарий (необязательно)">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={inputStyle}
            placeholder="Без лука, домофон 12B…"
          />
        </Field>
        <Field label="Оплата">
          <div style={{ display: "flex", gap: 8 }}>
            <PayBtn active={payment === "CASH"} onClick={() => setPayment("CASH")}>
              Наличные курьеру
            </PayBtn>
            <PayBtn active={payment === "CARD"} onClick={() => setPayment("CARD")}>
              Картой курьеру
            </PayBtn>
          </div>
        </Field>
      </section>

      {!hasGeo && (
        <div
          style={{
            background: "#3a2d12",
            border: "1px solid #5c4318",
            color: "#fbbf24",
            borderRadius: 10,
            padding: 10,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          Дайте браузеру разрешение на геолокацию, чтобы оформить заказ — без
          координат курьер не найдёт вас.
        </div>
      )}

      {result && !result.ok && (
        <ErrorBox text={result.error} />
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 14, opacity: 0.7 }}>Итого</span>
        <strong style={{ fontSize: 22 }}>{formatPrice(total)}</strong>
      </div>

      <button onClick={submit} disabled={!canSubmit} style={{
        ...primaryButton,
        opacity: canSubmit ? 1 : 0.4,
        cursor: canSubmit ? "pointer" : "not-allowed",
      }}>
        {submitting ? "Оформляем…" : "Оформить заказ"}
      </button>
    </>
  );
}

function FloatingCartBar({
  count,
  total,
  onClick,
}: {
  count: number;
  total: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 688,
        margin: "0 auto",
        padding: "14px 18px",
        border: "none",
        background: "#10b981",
        color: "#0a0a0a",
        borderRadius: 12,
        fontSize: 15,
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        boxShadow: "0 8px 24px #10b98155",
      }}
    >
      <span>Корзина · {count}</span>
      <span>{formatPrice(total)} →</span>
    </button>
  );
}

/* ============================== atoms ================================== */

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "60px 16px",
      }}
    >
      {children}
    </main>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 24,
        textAlign: "center",
        border: "1px dashed #2a2a2a",
        borderRadius: 12,
        color: "#737373",
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 12,
        background: "#2a0d0d",
        border: "1px solid #5c1a1a",
        color: "#fca5a5",
        borderRadius: 10,
        fontSize: 13,
        marginBottom: 12,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#a3a3a3", marginBottom: 4 }}>
        {label}
      </div>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: "#525252", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </label>
  );
}

function PayBtn({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 12px",
        border: `1px solid ${active ? "#10b981" : "#2a2a2a"}`,
        background: active ? "#10b98122" : "#111",
        color: active ? "#10b981" : "#ededed",
        borderRadius: 10,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #2a2a2a",
  background: "#0e0e0e",
  color: "#ededed",
  borderRadius: 10,
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const primaryButton: React.CSSProperties = {
  width: "100%",
  padding: "14px 18px",
  border: "none",
  background: "#10b981",
  color: "#0a0a0a",
  borderRadius: 12,
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  marginTop: 16,
};

/* ============================== utils ================================== */

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString("ru-RU")} сум`;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  if (!lat2 && !lng2) return Number.POSITIVE_INFINITY;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
