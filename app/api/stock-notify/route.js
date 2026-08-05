import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST /api/stock-notify — join the back-in-stock waitlist for a product.
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const body = await req.json().catch(() => ({}));
  const sku = (body.product_sku || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  if (!sku) return NextResponse.json({ ok: false, err: "Missing product." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, err: "Enter a valid email." });

  const db = await getServerSupabase();
  const { error } = await db.from("stock_notifications").insert({ product_sku: sku, email });
  // A duplicate (already on the waitlist) is a success from the shopper's point of view.
  if (error && !/duplicate|unique|23505/i.test(error.message)) {
    return NextResponse.json({ ok: false, err: error.message });
  }
  return NextResponse.json({ ok: true });
}
