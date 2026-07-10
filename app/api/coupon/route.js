import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/coupon?code=PURE10&subtotal=1200 — server-side coupon validation.
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
