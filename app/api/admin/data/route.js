import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { orderToEngine, warehouseToEngine, productToEngine } from "@/lib/shape";

export const dynamic = "force-dynamic";

// Operational data for the admin console (staff-only via RLS): orders, customers,
// coupons, returns — mapped back into the engine's in-memory shapes.
export async function GET() {
  if (!isConfigured()) return NextResponse.json({ configured: false });
  const db = await getServerSupabase();
  const { data: userRes } = await db.auth.getUser();
  if (!userRes?.user) return NextResponse.json({ ok: false, err: "Not signed in." }, { status: 401 });
  const { data: staff } = await db.from("staff").select("active").eq("user_id", userRes.user.id).maybeSingle();
  if (!staff?.active) return NextResponse.json({ ok: false, err: "Not authorized." }, { status: 403 });

  const [orders, customers, coupons, returns, analytics, warehouses, products] = await Promise.all([
    db.from("orders").select("*, order_items(*), order_events(*)").order("placed_at", { ascending: false }),
    db.from("customers").select("*").order("created_at", { ascending: false }),
    db.from("coupons").select("*"),
    db.from("returns").select("*").order("created_at", { ascending: false }),
    db.from("analytics_daily").select("*").order("day", { ascending: false }).limit(30),
    db.from("warehouses").select("*").order("id"),
    // ALL products (including drafts/archived) so every product is manageable in admin
    db.from("products").select("*, product_variants(*)").order("sort_order"),
  ]);

  // shape analytics into the engine's ANALYTICS.daily map (keyed by YYYY-MM-DD)
  const analyticsDaily = {};
  for (const a of analytics.data || []) {
    analyticsDaily[a.day] = { view: a.views, product: a.product_views, cart: a.add_to_cart, order: a.orders };
  }

  const couponMap = {};
  for (const c of coupons.data || []) {
    couponMap[c.code] = {
      type: c.type, value: Number(c.value), desc: c.description, active: c.active,
      uses: c.uses || 0, cap: c.cap || 0, minCart: Number(c.min_cart) || 0,
      expires: c.expires ? new Date(c.expires).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "",
      // Phase 4.2 targeting
      scope: c.scope || "all", productSkus: c.product_skus || [], userEmails: c.user_emails || [], perUserLimit: c.per_user_limit || 0,
    };
  }

  return NextResponse.json({
    ok: true,
    orders: (orders.data || []).map(orderToEngine),
    customers: (customers.data || []).map((c) => ({
      id: c.id, name: c.name, email: c.email, phone: c.phone, city: c.city, since: c.since, tags: c.tags || [],
    })),
    coupons: couponMap,
    returns: (returns.data || []).map((r) => ({
      id: r.id, orderId: r.order_no, customer: r.customer, sku: r.sku, reason: r.reason,
      status: r.status, refund: Number(r.refund) || 0, date: r.date, restock: r.restock,
    })),
    analytics: analyticsDaily,
    warehouses: (warehouses.data || []).map(warehouseToEngine),
    products: (products.data || []).map(productToEngine),
  });
}
