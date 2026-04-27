/**
 * Lightweight in-memory event bus + ring buffer for observability.
 *
 * Why in-memory: this MVP runs as Next.js + Vercel serverless functions with
 * "no DB, no Redis" by design. A module-scoped buffer is fine in `next dev`
 * and in a single warm lambda; events naturally evict on cold starts.
 *
 * For multi-instance prod analytics, swap the buffer for Vercel KV /
 * Upstash Redis behind the same `logEvent` / `getEvents` API — call sites
 * elsewhere need not change.
 *
 * The buffer is attached to `globalThis` so Next.js HMR doesn't wipe it
 * between hot reloads in development.
 */

export type EventKind = "oauth" | "delever_http" | "mcp_tool";

export interface MonitorEvent {
  id: number;
  ts: number;
  kind: EventKind;
  /** Delever endpoint path or MCP tool name. */
  label: string;
  method?: string;
  status?: number;
  ok: boolean;
  latencyMs: number;
  request?: unknown;
  response?: unknown;
  error?: string;
}

export interface MonitorStats {
  total: number;
  ok: number;
  errors: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  byKind: Record<EventKind, { total: number; errors: number }>;
  byTool: Record<string, { total: number; errors: number }>;
}

interface BufferState {
  buffer: MonitorEvent[];
  capacity: number;
  nextId: number;
  startedAt: number;
}

const GLOBAL_KEY = "__delever_event_log__";

function getState(): BufferState {
  const g = globalThis as unknown as Record<string, BufferState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      buffer: [],
      capacity: 500,
      nextId: 1,
      startedAt: Date.now(),
    };
  }
  return g[GLOBAL_KEY] as BufferState;
}

const MAX_PAYLOAD_CHARS = 8_000;

/** Truncate any value to a safe size for storage and JSON transport. */
function safeClone(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return String(value).slice(0, MAX_PAYLOAD_CHARS);
  }
  if (json.length > MAX_PAYLOAD_CHARS) {
    return {
      __truncated: true,
      preview: json.slice(0, MAX_PAYLOAD_CHARS) + "…",
      originalLength: json.length,
    };
  }
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

export interface LogEventInput {
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

export function logEvent(input: LogEventInput): MonitorEvent {
  const state = getState();
  const event: MonitorEvent = {
    id: state.nextId++,
    ts: Date.now(),
    kind: input.kind,
    label: input.label,
    method: input.method,
    status: input.status,
    ok: input.ok,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    request: safeClone(input.request),
    response: safeClone(input.response),
    error: input.error,
  };
  state.buffer.push(event);
  if (state.buffer.length > state.capacity) {
    state.buffer.splice(0, state.buffer.length - state.capacity);
  }
  return event;
}

export interface GetEventsOptions {
  limit?: number;
  sinceId?: number;
  kind?: EventKind | "all";
  errorsOnly?: boolean;
}

export function getEvents(opts: GetEventsOptions = {}): MonitorEvent[] {
  const state = getState();
  let out = state.buffer;
  if (opts.sinceId) {
    out = out.filter((e) => e.id > opts.sinceId!);
  }
  if (opts.kind && opts.kind !== "all") {
    out = out.filter((e) => e.kind === opts.kind);
  }
  if (opts.errorsOnly) {
    out = out.filter((e) => !e.ok);
  }
  if (opts.limit) {
    out = out.slice(-opts.limit);
  }
  return out.slice().reverse();
}

export function getStats(): MonitorStats & {
  capacity: number;
  uptimeMs: number;
} {
  const state = getState();
  const buf = state.buffer;
  const total = buf.length;
  const ok = buf.filter((e) => e.ok).length;
  const errors = total - ok;
  const latencies = buf.map((e) => e.latencyMs).sort((a, b) => a - b);
  const avg =
    total === 0 ? 0 : latencies.reduce((s, x) => s + x, 0) / total;
  const p95Idx = Math.max(0, Math.floor(latencies.length * 0.95) - 1);
  const p95 = latencies[p95Idx] ?? 0;

  const byKind: MonitorStats["byKind"] = {
    oauth: { total: 0, errors: 0 },
    delever_http: { total: 0, errors: 0 },
    mcp_tool: { total: 0, errors: 0 },
  };
  const byTool: MonitorStats["byTool"] = {};
  for (const e of buf) {
    byKind[e.kind].total += 1;
    if (!e.ok) byKind[e.kind].errors += 1;
    if (e.kind === "mcp_tool") {
      const slot = byTool[e.label] || { total: 0, errors: 0 };
      slot.total += 1;
      if (!e.ok) slot.errors += 1;
      byTool[e.label] = slot;
    }
  }

  return {
    total,
    ok,
    errors,
    successRate: total === 0 ? 1 : ok / total,
    avgLatencyMs: Math.round(avg),
    p95LatencyMs: Math.round(p95),
    byKind,
    byTool,
    capacity: state.capacity,
    uptimeMs: Date.now() - state.startedAt,
  };
}

export function clearEvents(): void {
  const state = getState();
  state.buffer = [];
  state.nextId = 1;
  state.startedAt = Date.now();
}

/**
 * Wrap any async function with timing + auto-logging. Captures both success
 * and failure paths and re-throws errors after recording them.
 */
export async function trace<T>(
  meta: Omit<LogEventInput, "ok" | "latencyMs" | "response" | "error">,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logEvent({
      ...meta,
      ok: true,
      latencyMs: Date.now() - start,
      response: result,
    });
    return result;
  } catch (err) {
    logEvent({
      ...meta,
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
