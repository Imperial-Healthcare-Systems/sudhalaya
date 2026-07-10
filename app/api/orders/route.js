import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { orderToEngine } from "@/lib/shape";

export const dynamic = "force-dynamic";

// POST /api/orders — place an order (server-authoritative pricing/stock via RPC).
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const body = await req.json().catch(() => ({}));
  const { items, customer, ship, payment_method, coupon } = body;
  if (!Array.isArray(items) || !items.length) return NextResponse.json({ ok: false, err: "Your cart is empty." });

  const db = await getServerSupabase();
  const { data, error } = await db.rpc("place_order", {
    p_items: items,
    p_customer: customer || {},
    p_ship: ship || {},
    p_payment_method: payment_method || "upi",
    p_coupon: coupon || null,
  });
  if (error) return NextResponse.json({ ok: false, err: error.message });
  return NextResponse.json(data);
}

// GET /api/orders — the signed-in shopper's order history.
export async function GET() {
  if (!isConfigured()) return NextResponse.json({ configured: false, orders: [] });
  const db = await getServerSupabase();
  const { data: userRes } = await db.auth.getUser();
  if (!userRes?.user) return NextResponse.json({ configured: true, orders: [] });

  const { data, error } = await db
    .from("orders")
    .select("*, order_items(*), order_events(*)")
    .eq("user_id", userRes.user.id)
    .order("placed_at", { ascending: false });
  if (error) return NextResponse.json({ configured: true, orders: [], err: error.message });
  return NextResponse.json({ configured: true, orders: (data || []).map(orderToEngine) });
}
