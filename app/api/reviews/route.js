import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Submit a product or homepage review. Client QA r2: reviews require a signed-in
// shopper and are held (approved=false) until an admin approves them. Public RLS
// shows only approved reviews, so a new review is not visible until moderated.
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const db = await getServerSupabase();

  const { data: userRes } = await db.auth.getUser();
  if (!userRes?.user) return NextResponse.json({ ok: false, err: "Please sign in to write a review." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rating = Math.max(1, Math.min(5, parseInt(body.rating) || 0));
  const text = (body.body || "").trim();
  if (!rating) return NextResponse.json({ ok: false, err: "Please pick a star rating." });
  if (text.length < 5) return NextResponse.json({ ok: false, err: "Please write a short review." });

  const authoredName = (body.name || userRes.user.user_metadata?.full_name || "").trim();

  if (body.kind === "home") {
    const { error } = await db.from("home_reviews").insert({
      body: text, name: authoredName || "Anonymous", location: (body.location || "").trim(),
      rating, verified: true, approved: false,
    });
    return error
      ? NextResponse.json({ ok: false, err: error.message })
      : NextResponse.json({ ok: true, pending: true });
  }

  if (!body.product_sku) return NextResponse.json({ ok: false, err: "Missing product." });
  const { error } = await db.from("product_reviews").insert({
    product_sku: body.product_sku, name: authoredName || "Verified Buyer",
    rating, body: text, verified: true, approved: false,
  });
  return error
    ? NextResponse.json({ ok: false, err: error.message })
    : NextResponse.json({ ok: true, pending: true });
}
