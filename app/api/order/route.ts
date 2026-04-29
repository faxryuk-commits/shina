/**
 * Public order endpoint used by the /order web page (NOT MCP).
 *
 * Accepts a JSON body matching `CreateOrderInput` and forwards to
 * `createOrder()`. Returns either the new order id or a structured error
 * the form can render. Logged through the same monitor as MCP calls.
 *
 * Security note: this route is currently open to anyone — fine for the
 * single-tenant MAX WAY rollout, but before opening up to other Delever
 * shippers add a captcha or simple rate limiter (Vercel KV) here.
 */

import { z } from "zod";
import { createOrder, type PaymentType } from "@/lib/deleverClient";
import { logEvent } from "@/lib/eventLog";

export const dynamic = "force-dynamic";

const orderSchema = z.object({
  restaurant_id: z.string().min(1),
  items: z
    .array(
      z.object({
        item_id: z.string().min(1),
        quantity: z.number().int().min(1).max(50),
        modifier_ids: z.array(z.string()).optional(),
      })
    )
    .min(1),
  delivery: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(5).max(40),
    address: z.string().min(1).max(500),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  payment: z.enum(["CARD", "CASH"]),
  comment: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const start = Date.now();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = orderSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "Validation failed",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  try {
    const result = await createOrder({
      restaurant_id: parsed.data.restaurant_id,
      items: parsed.data.items,
      delivery: parsed.data.delivery,
      payment: parsed.data.payment as PaymentType,
      comment: parsed.data.comment,
    });
    logEvent({
      kind: "mcp_tool",
      label: "web_order",
      ok: true,
      latencyMs: Date.now() - start,
      request: parsed.data,
      response: result,
    });
    return Response.json({ ok: true, order: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent({
      kind: "mcp_tool",
      label: "web_order",
      ok: false,
      latencyMs: Date.now() - start,
      request: parsed.data,
      error: message,
    });
    return Response.json(
      { ok: false, error: message },
      { status: 502 }
    );
  }
}
