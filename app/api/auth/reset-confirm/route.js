import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isConfigured } from "@/lib/supabase/server";
import { getAdminSupabase, hasServiceRole } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/mailer";
import { passwordChangedEmail } from "@/lib/email-templates";

export const dynamic = "force-dynamic";

const normPhone = (s) => { const d = (s || "").replace(/\D/g, "").slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : ""; };

// Step 2 of password reset: verify the emailed code, then set the new password.
export async function POST(req) {
  if (!isConfigured() || !hasServiceRole()) return NextResponse.json({ ok: false, configured: false });
  const { identifier, code, password } = await req.json().catch(() => ({}));
  const id = (identifier || "").trim();
  const otp = (code || "").replace(/\s/g, "");
  if (!id || !otp) return NextResponse.json({ ok: false, err: "Enter the code we emailed you." });
  if (!password || password.length < 6) return NextResponse.json({ ok: false, err: "Password must be at least 6 characters." });

  const admin = getAdminSupabase();

  // resolve identifier -> email (same rules as sign-in)
  let email = id.toLowerCase();
  const ph = id.includes("@") ? "" : normPhone(id);   // an "@" means it's an email, never a phone
  if (ph) {
    const { data: prof } = await admin.from("profiles").select("id").eq("phone", ph).maybeSingle();
    if (prof) { const { data: u } = await admin.auth.admin.getUserById(prof.id); email = u?.user?.email || ""; }
    else email = "";
  }
  if (!email) return NextResponse.json({ ok: false, err: "Invalid or expired code. Request a new one." });

  // Verify the recovery OTP on a throwaway client so the shopper's cookies aren't touched.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: vr, error: ve } = await anon.auth.verifyOtp({ email, token: otp, type: "recovery" });
  if (ve || !vr?.user) return NextResponse.json({ ok: false, err: "Invalid or expired code. Request a new one." });

  const { error: ue } = await admin.auth.admin.updateUserById(vr.user.id, { password });
  if (ue) return NextResponse.json({ ok: false, err: ue.message || "Could not update password." });

  // Notify the account owner that their password changed (security alert). Best-effort.
  try {
    const name = vr.user.user_metadata?.full_name || "";
    await sendMail({ to: email, ...passwordChangedEmail({ name }) });
  } catch { /* never fail the reset because the confirmation email didn't send */ }

  return NextResponse.json({ ok: true });
}
