/**
 * Public ordering landing page. Anyone can open it, give the browser
 * permission to share their location, pick a branch / dishes and place
 * an order — no account required.
 */

import { searchRestaurants, type RestaurantSummary } from "@/lib/deleverClient";
import OrderApp from "./OrderApp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrderPage() {
  let branches: RestaurantSummary[] = [];
  let error: string | null = null;
  try {
    branches = await searchRestaurants({
      language: "ru",
      with_menu_stats: true,
      menu_stats_timeout_ms: 6000,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Only branches that are online AND have a non-empty menu — there's no
  // point listing dead ones to a customer.
  const orderable = branches.filter(
    (b) => b.online && (b.menu_stats?.items_count || 0) > 0
  );

  return <OrderApp branches={orderable} loadError={error} />;
}
