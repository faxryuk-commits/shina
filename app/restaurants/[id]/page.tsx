import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getMenu,
  searchRestaurants,
  type MenuCategory,
  type MenuItem,
  type MenuResult,
  type RestaurantSummary,
  type ScheduleSlot,
} from "@/lib/deleverClient";
import {
  Card,
  EmptyState,
  ErrorBox,
  SectionTitle,
  StatPill,
} from "@/app/_components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface BranchPageProps {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadBranch(id: string): Promise<{
  branch: RestaurantSummary | null;
  menu: MenuResult | null;
  menuError: string | null;
  branchError: string | null;
}> {
  let branch: RestaurantSummary | null = null;
  let branchError: string | null = null;
  try {
    const list = await searchRestaurants({ language: "ru" });
    branch = list.find((r) => r.id === id) || null;
  } catch (err) {
    branchError = err instanceof Error ? err.message : String(err);
  }

  let menu: MenuResult | null = null;
  let menuError: string | null = null;
  try {
    menu = await getMenu({ restaurant_id: id, language: "ru" });
  } catch (err) {
    menuError = err instanceof Error ? err.message : String(err);
  }

  return { branch, menu, menuError, branchError };
}

export default async function BranchPage({ params }: BranchPageProps) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { branch, menu, menuError, branchError } = await loadBranch(id);

  const title = branch?.details_available
    ? branch.name
    : `Branch ${id.slice(0, 8)}…`;
  const address = branch?.details_available ? branch.address : "";
  const online = branch?.online ?? false;
  const dotColor = online ? "#10b981" : "#525252";

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "32px 24px 80px",
        lineHeight: 1.55,
      }}
    >
      <Link
        href="/"
        style={{
          color: "#737373",
          fontSize: 13,
          textDecoration: "none",
          letterSpacing: 0.3,
        }}
      >
        ← Все филиалы
      </Link>

      <header style={{ marginTop: 18, marginBottom: 28 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ fontSize: 30, margin: 0, letterSpacing: -0.5 }}>
            {title}
          </h1>
          <span
            title={online ? "online" : "offline"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: dotColor,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.4,
              padding: "4px 10px",
              borderRadius: 999,
              background: `${dotColor}22`,
              border: `1px solid ${dotColor}`,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: dotColor,
                boxShadow: online ? `0 0 8px ${dotColor}` : "none",
              }}
            />
            {online ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
        {address ? (
          <p style={{ opacity: 0.7, margin: "6px 0 0", fontSize: 14 }}>
            {address}
            {branch && branch.lat !== 0 && (
              <span
                style={{
                  marginLeft: 10,
                  fontSize: 12,
                  opacity: 0.7,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {branch.lat.toFixed(4)}, {branch.lng.toFixed(4)}
              </span>
            )}
          </p>
        ) : null}
        <p
          style={{
            opacity: 0.45,
            margin: "6px 0 0",
            fontSize: 11,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {id}
        </p>
        {branchError && <ErrorBox text={`Branch lookup: ${branchError}`} />}
      </header>

      {menuError ? (
        <ErrorBox text={`Menu fetch failed: ${menuError}`} />
      ) : !menu ? (
        <EmptyState text="Меню не загружено." />
      ) : (
        <BranchBody menu={menu} />
      )}
    </main>
  );
}

/* --------------------------- subcomponents --------------------------- */

function BranchBody({ menu }: { menu: MenuResult }) {
  const { summary } = menu;
  const stoppedItems = menu.items.filter((i) => !i.available);
  const totalGoodValue = menu.items.reduce(
    (acc, i) => acc + (i.available ? i.price : 0),
    0
  );

  return (
    <>
      <section>
        <SectionTitle>Сводка</SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          <StatPill label="Категорий" value={summary.categories_count} />
          <StatPill label="Товаров" value={summary.items_count} />
          <StatPill
            label="В наличии"
            value={summary.available_count}
            color="#10b981"
          />
          <StatPill
            label="На стопе"
            value={summary.unavailable_count}
            color={summary.unavailable_count > 0 ? "#ef4444" : "#737373"}
          />
        </div>
        <p
          style={{
            opacity: 0.5,
            marginTop: 12,
            marginBottom: 0,
            fontSize: 12,
          }}
        >
          Меню обновлено: {formatDateTime(menu.last_change)} ·
          {summary.items_count > 0
            ? ` суммарный прайс по «в наличии»: ${formatPrice(totalGoodValue)}`
            : " товары не загружены"}
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <SectionTitle>Часы работы</SectionTitle>
        <Card title="Restaurant working hours" accent="#737373">
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
            Часы работы конкретного филиала <strong>не предоставляются</strong>{" "}
            в Custom Integration API V2 (поля нет ни в{" "}
            <code>/restaurants</code>, ни в{" "}
            <code>/restaurants/availability</code>; <code>/v2/working-hours</code>{" "}
            существует только для веб/мобайл-разработчиков). Настраиваются они в
            админ-панели Delever (Каталог → Меню → Расписание). Текущая
            фактическая доступность филиала отражена бейджем «{ "ONLINE/OFFLINE" }»
            выше — он берётся из <code>/restaurants/availability</code>.
          </p>
        </Card>

        {menu.categories.some((c) => c.schedules.length > 0) ? (
          <div style={{ marginTop: 12 }}>
            <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 8 }}>
              Расписание категорий (когда категория доступна для заказа):
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 8,
              }}
            >
              {menu.categories
                .filter((c) => c.schedules.length > 0)
                .map((c) => (
                  <CategorySchedules key={c.id} category={c} />
                ))}
            </div>
          </div>
        ) : null}
      </section>

      <section style={{ marginTop: 32 }}>
        <SectionTitle>Категории</SectionTitle>
        {menu.categories.length === 0 ? (
          <EmptyState text="Нет категорий — меню в этом филиале пока не загружено в Delever." />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 8,
            }}
          >
            {menu.categories.map((c) => (
              <a
                key={c.id}
                href={`#cat-${c.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 12px",
                  border: "1px solid #1f1f1f",
                  borderRadius: 10,
                  textDecoration: "none",
                  color: "inherit",
                  background: "#0e0e0e",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 13,
                  }}
                >
                  {c.name}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "#737373",
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                  }}
                >
                  {c.item_count} шт
                </span>
              </a>
            ))}
          </div>
        )}
      </section>

      {stoppedItems.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <SectionTitle>На стопе ({stoppedItems.length})</SectionTitle>
          <Card title="Out of stock right now" accent="#ef4444">
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              {stoppedItems.map((it) => (
                <li key={it.id}>
                  <span style={{ opacity: 0.85 }}>{it.name}</span>{" "}
                  <span style={{ opacity: 0.5, fontSize: 12 }}>
                    · {it.category || "—"} · {formatPrice(it.price)}
                    {typeof it.stock === "number" && it.stock !== 0
                      ? ` · stock=${it.stock}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {menu.categories.length > 0 ? (
        <section style={{ marginTop: 32 }}>
          <SectionTitle>Товары</SectionTitle>
          {menu.categories.map((c) => (
            <CategorySection
              key={c.id}
              category={c}
              items={menu.items.filter((it) => it.category_id === c.id)}
            />
          ))}
        </section>
      ) : null}
    </>
  );
}

function CategorySchedules({ category }: { category: MenuCategory }) {
  return (
    <div
      style={{
        border: "1px solid #1f1f1f",
        borderRadius: 10,
        padding: "10px 12px",
        background: "#0e0e0e",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {category.name}
      </div>
      {category.schedules.map((s, idx) => (
        <ScheduleLine key={idx} slot={s} />
      ))}
    </div>
  );
}

function ScheduleLine({ slot }: { slot: ScheduleSlot }) {
  return (
    <div
      style={{
        fontSize: 12,
        opacity: 0.8,
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {slot.from}–{slot.till}
      </span>
      <span style={{ opacity: 0.7 }}>{slot.weekdays.join(", ")}</span>
    </div>
  );
}

function CategorySection({
  category,
  items,
}: {
  category: MenuCategory;
  items: MenuItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div id={`cat-${category.id}`} style={{ marginBottom: 24 }}>
      <h3
        style={{
          margin: "0 0 8px",
          fontSize: 16,
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span>{category.name}</span>
        <span
          style={{
            fontSize: 12,
            color: "#737373",
            fontWeight: 400,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {items.length} шт
        </span>
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 10,
        }}
      >
        {items.map((it) => (
          <ItemCard key={it.id} item={it} />
        ))}
      </div>
    </div>
  );
}

function ItemCard({ item }: { item: MenuItem }) {
  const stopped = !item.available;
  const stockKnown = typeof item.stock === "number";
  return (
    <div
      style={{
        position: "relative",
        border: `1px solid ${stopped ? "#5c1a1a" : "#1f1f1f"}`,
        background: stopped ? "#1d0d0d" : "#0e0e0e",
        borderRadius: 12,
        padding: 12,
        opacity: stopped ? 0.85 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <strong
          style={{
            fontSize: 14,
            lineHeight: 1.3,
            color: stopped ? "#fca5a5" : "#ededed",
          }}
        >
          {item.name}
        </strong>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: stopped ? "#9a4a4a" : "#10b981",
            textDecoration: stopped ? "line-through" : undefined,
            flexShrink: 0,
          }}
        >
          {formatPrice(item.price)}
        </span>
      </div>
      {item.description ? (
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 12,
            opacity: 0.65,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {item.description}
        </p>
      ) : null}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          fontSize: 11,
        }}
      >
        {item.measure > 0 && (
          <Pill text={`${item.measure} ${item.measure_unit || ""}`.trim()} />
        )}
        {item.modifiers.length > 0 && (
          <Pill text={`${item.modifiers.length} групп(ы) модификаторов`} />
        )}
        {stockKnown && (
          <Pill
            text={
              item.stock === 0
                ? "stock = 0"
                : `stock = ${item.stock}`
            }
            color={item.stock === 0 ? "#ef4444" : "#f59e0b"}
          />
        )}
        <Pill
          text={stopped ? "На стопе" : "В наличии"}
          color={stopped ? "#ef4444" : "#10b981"}
        />
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          opacity: 0.4,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.id}
      </div>
    </div>
  );
}

function Pill({ text, color }: { text: string; color?: string }) {
  const c = color || "#737373";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${c}66`,
        background: `${c}1a`,
        color: c,
        fontSize: 11,
        letterSpacing: 0.2,
      }}
    >
      {text}
    </span>
  );
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("ru-RU")} сум`;
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
