/**
 * Internal observability endpoint. Returns recent monitor events + stats
 * as JSON, so the dashboard can poll without re-rendering the whole page.
 *
 *   GET    /api/monitor                → { events, stats }
 *   GET    /api/monitor?sinceId=42     → only newer events (cheap polling)
 *   GET    /api/monitor?kind=oauth     → filter by kind
 *   GET    /api/monitor?errorsOnly=1   → only failed events
 *   DELETE /api/monitor                → clear log
 */

import { NextRequest, NextResponse } from "next/server";
import {
  clearEvents,
  getEvents,
  getStats,
  type EventKind,
} from "@/lib/eventLog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_KINDS: ReadonlyArray<EventKind | "all"> = [
  "all",
  "oauth",
  "delever_http",
  "mcp_tool",
];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sinceIdParam = url.searchParams.get("sinceId");
  const kindParam = url.searchParams.get("kind");
  const errorsOnly = url.searchParams.get("errorsOnly") === "1";
  const limitParam = url.searchParams.get("limit");

  const sinceId = sinceIdParam ? Number(sinceIdParam) : undefined;
  const kind =
    kindParam && (ALLOWED_KINDS as readonly string[]).includes(kindParam)
      ? (kindParam as EventKind | "all")
      : undefined;
  const limit = limitParam ? Math.min(500, Number(limitParam)) : 200;

  const events = getEvents({
    sinceId: Number.isFinite(sinceId) ? sinceId : undefined,
    kind,
    errorsOnly,
    limit,
  });
  const stats = getStats();

  return NextResponse.json(
    { events, stats },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

export async function DELETE() {
  clearEvents();
  return NextResponse.json({ ok: true });
}
