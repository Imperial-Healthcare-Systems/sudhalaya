import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Admin/staff login: authenticate, then require an active row in public.staff.
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const { email, password } = await req.json().catch(() => ({}));
  const db = await getServerSupabase();

  const { data, error } = await db.auth.signInWithPassword({ email: (email || "").trim(), password: password || "" });
  if (error) return NextResponse.json({ ok: false, err: "Invalid email or password." });

  const { data: staff } = await db.from("staff").select("role,name,active").eq("user_id", data.user.id).maybeSingle();
  if (!staff || !staff.active) {
    await db.auth.signOut();
    return NextResponse.json({ ok: false, err: "This account is not an active staff member." });
  }
  return NextResponse.json({ ok: true, name: staff.name || data.user.email, role: staff.role });
}
