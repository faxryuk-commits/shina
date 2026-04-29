import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getDeleverAccessToken, resetDeleverAuthCache } from "@/lib/deleverAuth";
import {
  searchRestaurants,
  type RestaurantSummary,
} from "@/lib/deleverClient";
import MonitorPanel from "./_components/MonitorPanel";
import {
  Card,
  EmptyState,
  ErrorBox,
  Grid,
  KV,
  SectionTitle,
  codeStyle,
  inlineCodeStyle,
} from "./_components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AuthProbe {
  ok: boolean;
  latencyMs: number;
  tokenPreview?: string;
  error?: string;
}

interface RestaurantsProbe {
  ok: boolean;
  latencyMs: number;
  restaurants: RestaurantSummary[];
  error?: string;
}

async function probeAuth(useMocks: boolean): Promise<AuthProbe> {
  if (useMocks) {
    return { ok: true, latencyMs: 0, tokenPreview: "—" };
  }
  const start = Date.now();
  try {
    resetDeleverAuthCache();
    const token = await getDeleverAccessToken();
    return {
      ok: true,
      latencyMs: Date.now() - start,
      tokenPreview: `${token.slice(0, 6)}…${token.slice(-4)} (${token.length} chars)`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeRestaurants(): Promise<RestaurantsProbe> {
  const start = Date.now();
  try {
    const restaurants = await searchRestaurants({
      language: "ru",
      with_menu_stats: true,
      menu_stats_timeout_ms: 6000,
    });
    return { ok: true, latencyMs: Date.now() - start, restaurants };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      restaurants: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function refreshAction() {
  "use server";
  resetDeleverAuthCache();
  revalidatePath("/");
}

function maskClientId(value: string | undefined): string {
  if (!value) return "—";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length})`;
}

function maskSecret(value: string | undefined): string {
  if (!value) return "—";
  return `••••••••••••••••••••••••••••••••${value.slice(-4)}`;
}

export default async function Home() {
  const useMocks = process.env.USE_MOCKS !== "false";
  const baseUrl = process.env.DELEVER_BASE_URL || "—";
  const clientId = process.env.DELEVER_CLIENT_ID;
  const clientSecret = process.env.DELEVER_CLIENT_SECRET;
  const oauthPath = process.env.DELEVER_OAUTH_PATH || "/security/oauth/token";

  const auth = await probeAuth(useMocks);
  const restaurants = auth.ok ? await probeRestaurants() : null;

  const mode = useMocks ? "MOCKS" : "LIVE";
  const modeColor = useMocks ? "#f59e0b" : "#10b981";
  const onlineCount = restaurants?.restaurants.filter((r) => r.online).length ?? 0;
  const withoutDetailsCount =
    restaurants?.restaurants.filter((r) => !r.details_available).length ?? 0;

  return (
    <main
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: "48px 24px 80px",
        lineHeight: 1.55,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div>
          <h1 style={{ fontSize: 36, margin: 0, letterSpacing: -0.5 }}>
            Delever MCP Bridge
          </h1>
          <p style={{ opacity: 0.65, margin: "4px 0 0" }}>
            Streamable HTTP MCP server, proxying Claude → Delever Ordering API V2.
          </p>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 999,
            background: `${modeColor}22`,
            border: `1px solid ${modeColor}`,
            color: modeColor,
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: 0.4,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: modeColor,
              boxShadow: `0 0 12px ${modeColor}`,
            }}
          />
          {mode}
        </span>
      </header>

      <section style={{ marginTop: 32 }}>
        <SectionTitle>Connectivity</SectionTitle>
        <Grid>
          <Card title="OAuth handshake">
            <StatusRow
              label="Status"
              ok={auth.ok}
              okLabel={useMocks ? "Skipped (mocks)" : "OK"}
              failLabel="FAILED"
            />
            <KV k="Endpoint" v={`${baseUrl}${oauthPath}`} />
            <KV k="Latency" v={auth.latencyMs ? `${auth.latencyMs} ms` : "—"} />
            <KV k="Token" v={auth.tokenPreview || "—"} />
            {auth.error && <ErrorBox text={auth.error} />}
          </Card>

          <Card title="Configuration">
            <KV k="USE_MOCKS" v={useMocks ? "true" : "false"} />
            <KV k="DELEVER_BASE_URL" v={baseUrl} />
            <KV k="DELEVER_CLIENT_ID" v={maskClientId(clientId)} />
            <KV k="DELEVER_CLIENT_SECRET" v={maskSecret(clientSecret)} />
            <KV k="DELEVER_OAUTH_PATH" v={oauthPath} />
          </Card>
        </Grid>
      </section>

      <section style={{ marginTop: 32 }}>
        <SectionTitle>Monitoring</SectionTitle>
        <p style={{ opacity: 0.55, marginTop: 0, fontSize: 13 }}>
          Live feed of every Delever HTTP call, OAuth handshake and MCP tool
          invocation. Auto-refreshes every 2&nbsp;seconds. Buffer is in-memory
          and resets on cold start.
        </p>
        <MonitorPanel />
      </section>

      <section style={{ marginTop: 40 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <SectionTitle inline>Restaurants</SectionTitle>
          <form action={refreshAction}>
            <button
              type="submit"
              style={{
                background: "transparent",
                color: "#a3a3a3",
                border: "1px solid #2a2a2a",
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 12,
                letterSpacing: 0.4,
              }}
            >
              ↻ Refresh
            </button>
          </form>
        </div>

        {restaurants ? (
          restaurants.ok ? (
            <>
              <p style={{ opacity: 0.6, marginTop: 0, fontSize: 13 }}>
                {restaurants.restaurants.length} total · {onlineCount} online
                {withoutDetailsCount > 0 &&
                  ` · ${withoutDetailsCount} without details (Delever cap)`}{" "}
                · fetched in {restaurants.latencyMs} ms
              </p>
              {restaurants.restaurants.length === 0 ? (
                <EmptyState text="No restaurants returned by the API." />
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 12,
                  }}
                >
                  {restaurants.restaurants.map((r) => (
                    <RestaurantCard key={r.id} r={r} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <ErrorBox text={restaurants.error || "Unknown error"} />
          )
        ) : (
          <EmptyState text="Skipped — fix OAuth first." />
        )}
      </section>

      <section style={{ marginTop: 40 }}>
        <SectionTitle>MCP Endpoints</SectionTitle>
        <Grid>
          <Card title="Streamable HTTP">
            <code style={codeStyle}>/api/mcp</code>
            <p style={{ opacity: 0.6, fontSize: 13, marginTop: 8 }}>
              Use this URL in Claude.ai → Settings → Connectors → Add custom
              connector.
            </p>
          </Card>
          <Card title="SSE (legacy clients)">
            <code style={codeStyle}>/api/sse</code>
            <p style={{ opacity: 0.6, fontSize: 13, marginTop: 8 }}>
              Older MCP clients without Streamable HTTP support.
            </p>
          </Card>
        </Grid>
      </section>

      <section style={{ marginTop: 40 }}>
        <SectionTitle>Tools exposed</SectionTitle>
        <ul
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 6,
            margin: 0,
            padding: 0,
            listStyle: "none",
            opacity: 0.85,
          }}
        >
          {EXPOSED_TOOLS.map((t) => (
            <li
              key={t.name}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                padding: "6px 0",
                borderBottom: "1px dashed #1f1f1f",
                fontSize: 13,
              }}
            >
              <code style={inlineCodeStyle}>{t.name}</code>
              <span style={{ opacity: 0.55, fontSize: 12 }}>{t.desc}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/* ------------------------------ UI atoms ------------------------------- */

function StatusRow({
  label,
  ok,
  okLabel,
  failLabel,
}: {
  label: string;
  ok: boolean;
  okLabel: string;
  failLabel: string;
}) {
  const color = ok ? "#10b981" : "#ef4444";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 0",
        fontSize: 13,
        borderBottom: "1px dashed #1f1f1f",
      }}
    >
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color,
          fontWeight: 600,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: color,
            boxShadow: `0 0 8px ${color}`,
          }}
        />
        {ok ? okLabel : failLabel}
      </span>
    </div>
  );
}

function RestaurantCard({ r }: { r: RestaurantSummary }) {
  const dotColor = r.online ? "#10b981" : "#525252";
  const hasDetails = r.details_available;
  const stats = r.menu_stats;
  const hasMenu = !!stats && stats.items_count > 0;

  // For branches without details, surface the first few category names as a
  // "fingerprint" so the user can recognise the branch even though Delever
  // refuses to expose its title via the API.
  const fingerprint =
    !hasDetails && stats && stats.category_names.length > 0
      ? stats.category_names.slice(0, 3).join(" · ")
      : "";

  return (
    <Link
      href={`/restaurants/${r.id}`}
      style={{
        display: "block",
        border: `1px solid ${hasDetails ? "#1f1f1f" : "#3a2d12"}`,
        background: hasDetails ? "#111" : "#161208",
        borderRadius: 12,
        padding: 14,
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 0.15s ease, transform 0.05s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <strong
          style={{
            fontSize: 14,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: hasDetails ? "#ededed" : "#d4af37",
          }}
        >
          {hasDetails
            ? r.name
            : fingerprint
              ? fingerprint
              : `Branch ${r.id.slice(0, 8)}…`}
        </strong>
        <span
          title={r.online ? "online" : "offline"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: dotColor,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.4,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: dotColor,
              boxShadow: r.online ? `0 0 8px ${dotColor}` : "none",
            }}
          />
          {r.online ? "ONLINE" : "OFFLINE"}
        </span>
      </div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
        {hasDetails
          ? r.address || "—"
          : "Имя/адрес не отдаются API V2 (cap of 10 в /restaurants). Меню/заказы доступны."}
      </div>

      <MenuStatsRow stats={stats} hasMenu={hasMenu} />

      <div
        style={{
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            opacity: 0.5,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {r.id}
          {hasDetails && ` · ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`}
        </div>
        <span
          style={{
            fontSize: 11,
            color: "#737373",
            letterSpacing: 0.4,
            flexShrink: 0,
          }}
        >
          Меню →
        </span>
      </div>
    </Link>
  );
}

function MenuStatsRow({
  stats,
  hasMenu,
}: {
  stats: RestaurantSummary["menu_stats"];
  hasMenu: boolean;
}) {
  if (!stats) {
    return (
      <div
        style={{
          fontSize: 11,
          color: "#737373",
          letterSpacing: 0.3,
          marginBottom: 2,
        }}
      >
        —
      </div>
    );
  }
  if (stats.error) {
    return (
      <div
        style={{
          fontSize: 11,
          color: "#f59e0b",
          letterSpacing: 0.3,
          marginBottom: 2,
        }}
        title={stats.error}
      >
        Меню недоступно
      </div>
    );
  }
  if (!hasMenu) {
    return (
      <div
        style={{
          fontSize: 11,
          color: "#737373",
          letterSpacing: 0.3,
          marginBottom: 2,
        }}
      >
        Меню пустое
      </div>
    );
  }
  const stopColor = stats.unavailable_count > 0 ? "#ef4444" : "#737373";
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        fontSize: 11,
        marginBottom: 2,
      }}
    >
      <StatChip label={`${stats.categories_count} кат.`} />
      <StatChip label={`${stats.items_count} тов.`} />
      <StatChip
        label={
          stats.unavailable_count > 0
            ? `${stats.unavailable_count} стоп`
            : "0 стоп"
        }
        color={stopColor}
      />
    </div>
  );
}

function StatChip({ label, color }: { label: string; color?: string }) {
  const c = color || "#737373";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 7px",
        borderRadius: 999,
        border: `1px solid ${c}55`,
        background: `${c}1a`,
        color: c,
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: 0.2,
      }}
    >
      {label}
    </span>
  );
}

const EXPOSED_TOOLS: { name: string; desc: string }[] = [
  { name: "search_restaurants", desc: "list branches + online status" },
  { name: "get_menu", desc: "categories, items, modifiers, stop list" },
  { name: "create_order", desc: "place a new order on the POS" },
  { name: "get_order", desc: "full order details (items, payment, address)" },
  { name: "get_order_status", desc: "ACCEPTED → COOKING → … → DELIVERED" },
  { name: "update_order_status", desc: "DELIVERED / TAKEN_BY_COURIER / CANCELLED" },
  { name: "cancel_order", desc: "cancel a placed order with a reason" },
  { name: "list_promo_items", desc: "menu items participating in promos" },
];
