import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/admin/report/region?from=2026-01-01&to=2026-12-31&group=state|city
// Staff + 'reports' gated (enforced by the SECURITY DEFINER function).
export async function GET(req) {
  if (!isConfigured()) return NextResponse.json({ configured: false });
  const db = await getServerSupabase();
  const { data: userRes } = await db.auth.getUser();
  if (!userRes?.user) return NextResponse.json({ ok: false, err: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "2026-01-01";
  const to = searchParams.get("to") || "2099-12-31";
  const group = searchParams.get("group") === "city" ? "city" : "state";

  const { data, error } = await db.rpc("sales_by_region", { p_from: from, p_to: to, p_group: group });
  if (error) return NextResponse.json({ ok: false, err: error.message });
  return NextResponse.json({ ok: true, group, from, to, rows: data || [] });
}
