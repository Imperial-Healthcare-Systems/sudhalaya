import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const normPhone = (s) => { const d = (s || "").replace(/\D/g, "").slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : ""; };

export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const { name, email, phone, password } = await req.json().catch(() => ({}));
  const em = (email || "").trim().toLowerCase();
  const ph = normPhone(phone);

  if (!name || !name.trim()) return NextResponse.json({ ok: false, err: "Please enter your name." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return NextResponse.json({ ok: false, err: "Enter a valid email address." });
  if (!ph) return NextResponse.json({ ok: false, err: "Enter a valid 10-digit mobile number." });
  if (!password || password.length < 6) return NextResponse.json({ ok: false, err: "Password must be at least 6 characters." });

  const admin = getAdminSupabase();

  // phone uniqueness
  const { data: dupe } = await admin.from("profiles").select("id").eq("phone", ph).maybeSingle();
  if (dupe) return NextResponse.json({ ok: false, err: "An account with this mobile number already exists." });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: em, password, email_confirm: true, user_metadata: { full_name: name.trim(), phone: ph },
  });
  if (createErr) {
    const msg = /already|registered|exists/i.test(createErr.message)
      ? "An account with this email already exists. Try signing in." : createErr.message;
    return NextResponse.json({ ok: false, err: msg });
  }
  const uid = created.user.id;
  await admin.from("profiles").upsert({ id: uid, full_name: name.trim(), phone: ph });
  await admin.from("customers").upsert(
    { name: name.trim(), email: em, phone: ph, user_id: uid, tags: ["registered"], since: new Date().toISOString().slice(0, 10) },
    { onConflict: "email" }
  );

  // establish the session (sets cookies)
  const db = await getServerSupabase();
  const { error: signErr } = await db.auth.signInWithPassword({ email: em, password });
  if (signErr) return NextResponse.json({ ok: false, err: signErr.message });

  return NextResponse.json({ ok: true, user: { name: name.trim(), email: em, phone: ph } });
}
