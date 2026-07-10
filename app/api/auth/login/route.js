import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const normPhone = (s) => { const d = (s || "").replace(/\D/g, "").slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : ""; };

// Sign in with email OR registered mobile number (client #11).
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const { identifier, password } = await req.json().catch(() => ({}));
  const id = (identifier || "").trim();

  let email = id.toLowerCase();
  const ph = normPhone(id);
  if (ph) {
    // resolve phone -> email via profiles (service role)
    const admin = getAdminSupabase();
    const { data: prof } = await admin.from("profiles").select("id").eq("phone", ph).maybeSingle();
    if (prof) {
      const { data: u } = await admin.auth.admin.getUserById(prof.id);
      email = u?.user?.email || "";
    } else email = "";
  }
  if (!email) return NextResponse.json({ ok: false, err: "No account found for that email or mobile number." });

  const db = await getServerSupabase();
  const { data, error } = await db.auth.signInWithPassword({ email, password: password || "" });
  if (error) {
    const msg = /invalid/i.test(error.message) ? "Incorrect email/mobile or password." : error.message;
    return NextResponse.json({ ok: false, err: msg });
  }
  const user = data.user;
  return NextResponse.json({
    ok: true,
    user: { name: user.user_metadata?.full_name || "", email: user.email, phone: user.user_metadata?.phone || "" },
  });
}
