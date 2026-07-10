import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { productToEngine, categoryToEngine } from "@/lib/shape";

export const dynamic = "force-dynamic";

// One call the storefront makes on boot: catalog + config + session.
// When Supabase isn't configured, returns { configured:false } so the engine
// falls back to its built-in localStorage seeds (demo keeps working).
export async function GET() {
  if (!isConfigured()) return NextResponse.json({ configured: false });

  try {
    const db = await getServerSupabase();

    const [{ data: products }, { data: categories }, { data: config }, { data: homeReviews }, { data: prodReviews }, { data: userRes }] =
      await Promise.all([
        db.from("products").select("*, product_variants(*)").eq("draft", false).order("sort_order"),
        db.from("categories").select("*").eq("active", true).order("sort_order"),
        db.from("app_config").select("key,value"),
        db.from("home_reviews").select("*").eq("approved", true).order("created_at", { ascending: false }),
        db.from("product_reviews").select("*").eq("approved", true).order("created_at", { ascending: false }),
        db.auth.getUser(),
      ]);

    const cfg = Object.fromEntries((config || []).map((r) => [r.key, r.value]));
    // group product reviews by product id (engine keys REVIEWS by product id)
    const skuToId = Object.fromEntries((products || []).map((p) => [p.sku, p.id]));
    const reviews = {};
    for (const r of prodReviews || []) {
      const pid = skuToId[r.product_sku];
      if (pid == null) continue;
      (reviews[pid] = reviews[pid] || []).push({ n: r.name, r: r.rating, t: r.body, v: r.verified });
    }
    const user = userRes?.user
      ? { name: userRes.user.user_metadata?.full_name || "", email: userRes.user.email, phone: userRes.user.user_metadata?.phone || "" }
      : null;

    return NextResponse.json({
      configured: true,
      products: (products || []).map(productToEngine),
      categories: (categories || []).map(categoryToEngine),
      settings: cfg.settings || null,
      cms: cfg.cms || null,
      homeReviews: (homeReviews || []).map((r) => ({ t: r.body, n: r.name, l: r.location, r: r.rating, v: r.verified })),
      reviews,
      user,
    });
  } catch (e) {
    return NextResponse.json({ configured: false, error: String(e?.message || e) });
  }
}
