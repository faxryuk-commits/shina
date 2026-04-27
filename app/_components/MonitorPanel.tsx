"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type EventKind = "oauth" | "delever_http" | "mcp_tool";

interface MonitorEvent {
  id: number;
  ts: number;
  kind: EventKind;
  label: string;
  method?: string;
  status?: number;
  ok: boolean;
  latencyMs: number;
  request?: unknown;
  response?: unknown;
  error?: string;
}

interface MonitorStats {
  total: number;
  ok: number;
  errors: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  byKind: Record<EventKind, { total: number; errors: number }>;
  byTool: Record<string, { total: number; errors: number }>;
  capacity: number;
  uptimeMs: number;
}

interface MonitorPayload {
  events: MonitorEvent[];
  stats: MonitorStats;
}

type KindFilter = "all" | EventKind;

const POLL_INTERVAL_MS = 2000;
const MAX_KEPT_EVENTS = 500;

const KIND_LABELS: Record<KindFilter, string> = {
  all: "All",
  oauth: "OAuth",
  delever_http: "Delever HTTP",
  mcp_tool: "MCP tools",
};

const KIND_COLORS: Record<EventKind, string> = {
  oauth: "#a855f7",
  delever_http: "#38bdf8",
  mcp_tool: "#f59e0b",
};

export default function MonitorPanel() {
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [paused, setPaused] = useState(false);
  const [kind, setKind] = useState<KindFilter>("all");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const fetchOnce = useCallback(
    async (mode: "full" | "delta") => {
      try {
        const sinceId =
          mode === "delta" && events.length > 0
            ? Math.max(...events.map((e) => e.id))
            : undefined;
        const params = new URLSearchParams();
        if (sinceId !== undefined) params.set("sinceId", String(sinceId));
        params.set("limit", "200");
        const res = await fetch(`/api/monitor?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`monitor ${res.status}`);
        const data = (await res.json()) as MonitorPayload;
        setStats(data.stats);
        setLoadError(null);
        setLastUpdate(Date.now());
        if (mode === "delta") {
          if (data.events.length === 0) return;
          setEvents((prev) => {
            const merged = [...data.events, ...prev];
            const seen = new Set<number>();
            const dedup: MonitorEvent[] = [];
            for (const e of merged) {
              if (seen.has(e.id)) continue;
              seen.add(e.id);
              dedup.push(e);
            }
            dedup.sort((a, b) => b.id - a.id);
            return dedup.slice(0, MAX_KEPT_EVENTS);
          });
        } else {
          setEvents(data.events);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    },
    [events]
  );

  useEffect(() => {
    void fetchOnce("full");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      void fetchOnce("delta");
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [paused, fetchOnce]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (kind !== "all" && e.kind !== kind) return false;
      if (errorsOnly && e.ok) return false;
      return true;
    });
  }, [events, kind, errorsOnly]);

  const handleClear = useCallback(async () => {
    await fetch("/api/monitor", { method: "DELETE" });
    setEvents([]);
    setExpanded({});
    void fetchOnce("full");
  }, [fetchOnce]);

  return (
    <div>
      <StatsRow stats={stats} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          margin: "16px 0 12px",
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(KIND_LABELS) as KindFilter[]).map((k) => (
            <Chip
              key={k}
              active={kind === k}
              onClick={() => setKind(k)}
              dot={k !== "all" ? KIND_COLORS[k as EventKind] : undefined}
            >
              {KIND_LABELS[k]}
              {stats && k !== "all" ? ` · ${stats.byKind[k as EventKind].total}` : ""}
            </Chip>
          ))}
          <Chip
            active={errorsOnly}
            onClick={() => setErrorsOnly((v) => !v)}
            dot="#ef4444"
          >
            Errors only{stats ? ` · ${stats.errors}` : ""}
          </Chip>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, opacity: 0.5 }}>
            {paused
              ? "Paused"
              : lastUpdate
                ? `Live · updated ${ago(lastUpdate)}`
                : "Live"}
          </span>
          <Button onClick={() => setPaused((v) => !v)}>
            {paused ? "▶ Resume" : "⏸ Pause"}
          </Button>
          <Button onClick={() => void fetchOnce("full")}>↻ Reload</Button>
          <Button onClick={handleClear} variant="danger">
            ✕ Clear log
          </Button>
        </div>
      </div>

      {loadError && (
        <div
          style={{
            padding: "8px 12px",
            background: "#2a0d0d",
            border: "1px solid #5c1a1a",
            color: "#fca5a5",
            fontSize: 12,
            borderRadius: 8,
            marginBottom: 8,
          }}
        >
          Failed to load events: {loadError}
        </div>
      )}

      <EventList
        events={filtered}
        expanded={expanded}
        toggleExpand={(id) =>
          setExpanded((m) => ({ ...m, [id]: !m[id] }))
        }
      />

      {stats && (
        <p
          style={{
            marginTop: 12,
            fontSize: 11,
            opacity: 0.45,
            textAlign: "right",
          }}
        >
          Showing {filtered.length} of {events.length} buffered (capacity{" "}
          {stats.capacity}). Buffer is in-memory and resets on cold start.
        </p>
      )}
    </div>
  );
}

/* ------------------------------ subviews ------------------------------- */

function StatsRow({ stats }: { stats: MonitorStats | null }) {
  if (!stats) {
    return (
      <Grid>
        <StatCard label="Total" value="…" />
        <StatCard label="Success rate" value="…" />
        <StatCard label="Avg latency" value="…" />
        <StatCard label="p95 latency" value="…" />
      </Grid>
    );
  }
  const success = `${(stats.successRate * 100).toFixed(1)}%`;
  const successColor =
    stats.total === 0
      ? "#a3a3a3"
      : stats.successRate >= 0.99
        ? "#10b981"
        : stats.successRate >= 0.8
          ? "#f59e0b"
          : "#ef4444";
  const tools = Object.entries(stats.byTool);
  return (
    <>
      <Grid>
        <StatCard
          label="Total events"
          value={stats.total.toString()}
          sub={`${stats.ok} ok · ${stats.errors} err`}
        />
        <StatCard
          label="Success rate"
          value={success}
          valueColor={successColor}
        />
        <StatCard label="Avg latency" value={`${stats.avgLatencyMs} ms`} />
        <StatCard label="p95 latency" value={`${stats.p95LatencyMs} ms`} />
      </Grid>
      {tools.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 12,
          }}
        >
          <span style={{ fontSize: 11, opacity: 0.5, alignSelf: "center" }}>
            MCP tool calls:
          </span>
          {tools.map(([name, s]) => (
            <span
              key={name}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 999,
                border: "1px solid #2a2a2a",
                background: "#111",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              <span style={{ color: KIND_COLORS.mcp_tool }}>{name}</span>{" "}
              <span style={{ opacity: 0.7 }}>{s.total}</span>
              {s.errors > 0 && (
                <span style={{ color: "#ef4444" }}> · {s.errors} err</span>
              )}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function EventList({
  events,
  expanded,
  toggleExpand,
}: {
  events: MonitorEvent[];
  expanded: Record<number, boolean>;
  toggleExpand: (id: number) => void;
}) {
  if (events.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          border: "1px dashed #2a2a2a",
          borderRadius: 12,
          color: "#737373",
          fontSize: 13,
        }}
      >
        No events yet. Trigger an MCP tool call or press <strong>Refresh</strong>{" "}
        on the connectivity card to generate one.
      </div>
    );
  }
  return (
    <div
      style={{
        border: "1px solid #1f1f1f",
        borderRadius: 12,
        overflow: "hidden",
        background: "#0d0d0d",
      }}
    >
      {events.map((e, idx) => (
        <EventRow
          key={e.id}
          event={e}
          isLast={idx === events.length - 1}
          isOpen={!!expanded[e.id]}
          onToggle={() => toggleExpand(e.id)}
        />
      ))}
    </div>
  );
}

function EventRow({
  event,
  isLast,
  isOpen,
  onToggle,
}: {
  event: MonitorEvent;
  isLast: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const dot = KIND_COLORS[event.kind];
  const statusColor = event.ok ? "#10b981" : "#ef4444";
  return (
    <div
      style={{
        borderBottom: isLast ? "none" : "1px solid #1a1a1a",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "auto auto 1fr auto auto auto",
          gap: 12,
          alignItems: "center",
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          color: "#ededed",
          textAlign: "left",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            opacity: 0.55,
            width: 86,
          }}
        >
          {fmtTime(event.ts)}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: dot,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            width: 100,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: dot,
            }}
          />
          {kindShort(event.kind)}
        </span>
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {event.method && (
            <span style={{ opacity: 0.6, marginRight: 6 }}>
              {event.method}
            </span>
          )}
          {event.label}
        </span>
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            opacity: 0.65,
            width: 60,
            textAlign: "right",
          }}
        >
          {event.latencyMs} ms
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            color: statusColor,
            fontWeight: 600,
            width: 56,
            justifyContent: "flex-end",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: statusColor,
            }}
          />
          {event.status ?? (event.ok ? "OK" : "ERR")}
        </span>
        <span style={{ opacity: 0.4, fontSize: 11, width: 14 }}>
          {isOpen ? "▾" : "▸"}
        </span>
      </button>
      {isOpen && (
        <div
          style={{
            background: "#0a0a0a",
            padding: "0 14px 14px",
            display: "grid",
            gap: 10,
          }}
        >
          {event.error && (
            <DetailBlock title="Error" tone="error">
              {event.error}
            </DetailBlock>
          )}
          {event.request !== undefined && (
            <DetailBlock title="Request">
              {prettyJson(event.request)}
            </DetailBlock>
          )}
          {event.response !== undefined && (
            <DetailBlock title="Response">
              {prettyJson(event.response)}
            </DetailBlock>
          )}
        </div>
      )}
    </div>
  );
}

function DetailBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "error";
  children: string;
}) {
  const isError = tone === "error";
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: isError ? "#fca5a5" : "#737373",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <pre
        style={{
          margin: 0,
          padding: 10,
          background: isError ? "#2a0d0d" : "#111",
          border: `1px solid ${isError ? "#5c1a1a" : "#1f1f1f"}`,
          borderRadius: 6,
          color: isError ? "#fca5a5" : "#d4d4d4",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 360,
          overflow: "auto",
        }}
      >
        {children}
      </pre>
    </div>
  );
}

/* -------------------------------- atoms -------------------------------- */

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #1f1f1f",
        background: "#111",
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "#737373",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: valueColor || "#ededed",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  dot,
  children,
}: {
  active: boolean;
  onClick: () => void;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 999,
        border: `1px solid ${active ? "#3f3f3f" : "#1f1f1f"}`,
        background: active ? "#1a1a1a" : "transparent",
        color: active ? "#ededed" : "#a3a3a3",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: dot,
          }}
        />
      )}
      {children}
    </button>
  );
}

function Button({
  onClick,
  children,
  variant,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "danger";
}) {
  const isDanger = variant === "danger";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        color: isDanger ? "#fca5a5" : "#a3a3a3",
        border: `1px solid ${isDanger ? "#5c1a1a" : "#2a2a2a"}`,
        padding: "5px 10px",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 12,
      }}
    >
      {children}
    </button>
  );
}

/* ------------------------------- helpers ------------------------------- */

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function ago(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 1500) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  return `${Math.floor(diff / 60_000)}m ago`;
}

function kindShort(k: EventKind): string {
  switch (k) {
    case "oauth":
      return "OAUTH";
    case "delever_http":
      return "HTTP";
    case "mcp_tool":
      return "MCP";
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
