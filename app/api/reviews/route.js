import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Submit a product or homepage review. RLS allows anonymous inserts; new reviews
// are visible immediately (approved=true) to match the current storefront behaviour.
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const body = await req.json().catch(() => ({}));
  const rating = Math.max(1, Math.min(5, parseInt(body.rating) || 0));
  const text = (body.body || "").trim();
  if (!rating) return NextResponse.json({ ok: false, err: "Please pick a star rating." });
  if (text.length < 5) return NextResponse.json({ ok: false, err: "Please write a short review." });

  const db = await getServerSupabase();
  if (body.kind === "home") {
    const { error } = await db.from("home_reviews").insert({
      body: text, name: (body.name || "Anonymous").trim(), location: (body.location || "").trim(),
      rating, verified: false,
    });
    return error ? NextResponse.json({ ok: false, err: error.message }) : NextResponse.json({ ok: true });
  }
  if (!body.product_sku) return NextResponse.json({ ok: false, err: "Missing product." });
  const { error } = await db.from("product_reviews").insert({
    product_sku: body.product_sku, name: (body.name || "Verified Buyer").trim(), rating, body: text, verified: true,
  });
  return error ? NextResponse.json({ ok: false, err: error.message }) : NextResponse.json({ ok: true });
}
