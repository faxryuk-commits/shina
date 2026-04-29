/**
 * Lightweight public read-only menu endpoint used by the /order page.
 * Wraps `getMenu()` and returns the same shape as the MCP `get_menu`
 * tool, but as a plain JSON response (no MCP framing).
 */

import { getMenu } from "@/lib/deleverClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = searchParams.get("restaurant_id");
  const language = (searchParams.get("language") || "ru") as "ru" | "en" | "uz";

  if (!restaurantId) {
    return Response.json(
      { ok: false, error: "restaurant_id is required" },
      { status: 400 }
    );
  }

  try {
    const menu = await getMenu({
      restaurant_id: restaurantId,
      language,
    });
    return Response.json({ ok: true, menu });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
