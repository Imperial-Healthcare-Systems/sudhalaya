import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST /api/coupon  { code, subtotal, items:[{sku,amount}] }
// Scope-aware validation; the user email comes from the session (not trusted from client).
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ configured: false });
  const { code, subtotal, items } = await req.json().catch(() => ({}));
  const db = await getServerSupabase();
  const { data: userRes } = await db.auth.getUser();
  const email = userRes?.user?.email || null;
  const { data, error } = await db.rpc("validate_coupon", {
    p_code: code || "", p_subtotal: Number(subtotal) || 0, p_user_email: email, p_item_skus: items || [],
  });
  if (error) {
    // Graceful fallback if migration 0012 (4-arg form) isn't applied yet: use legacy 2-arg.
    const legacy = await db.rpc("validate_coupon", { p_code: code || "", p_subtotal: Number(subtotal) || 0 });
    if (legacy.error) return NextResponse.json({ valid: false, reason: legacy.error.message });
    return NextResponse.json(legacy.data);
  }
  return NextResponse.json(data);
}

// GET (legacy 2-arg) kept for backward compatibility.
export async function GET(req) {
  if (!isConfigured()) return NextResponse.json({ configured: false });
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code") || "";
  const subtotal = Number(searchParams.get("subtotal") || 0);
  const db = await getServerSupabase();
  const { data, error } = await db.rpc("validate_coupon", { p_code: code, p_subtotal: subtotal });
  if (error) return NextResponse.json({ valid: false, reason: error.message });
  return NextResponse.json(data);
}
