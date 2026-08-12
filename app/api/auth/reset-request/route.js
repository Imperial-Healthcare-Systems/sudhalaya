import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/supabase/server";
import { getAdminSupabase, hasServiceRole } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/mailer";
import { passwordResetEmail } from "@/lib/email-templates";

export const dynamic = "force-dynamic";

const normPhone = (s) => { const d = (s || "").replace(/\D/g, "").slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : ""; };
// Generic reply — never reveal whether an account exists (avoids user enumeration).
const GENERIC = "If an account exists for that email or mobile, we've emailed a reset code.";

// Step 1 of password reset: email a one-time code (via our own SMTP).
export async function POST(req) {
  if (!isConfigured() || !hasServiceRole()) return NextResponse.json({ ok: false, configured: false });
  const { identifier } = await req.json().catch(() => ({}));
  const id = (identifier || "").trim();
  if (!id) return NextResponse.json({ ok: false, err: "Enter your email or mobile number." });

  const admin = getAdminSupabase();

  // resolve identifier (email or registered mobile) -> email
  let email = id.toLowerCase();
  const ph = id.includes("@") ? "" : normPhone(id);   // an "@" means it's an email, never a phone
  if (ph) {
    const { data: prof } = await admin.from("profiles").select("id").eq("phone", ph).maybeSingle();
    if (prof) { const { data: u } = await admin.auth.admin.getUserById(prof.id); email = u?.user?.email || ""; }
    else email = "";
  }

  // If we can't resolve a valid email, still return the generic message.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: true, message: GENERIC });

  // generateLink creates the recovery OTP server-side WITHOUT sending anything —
  // we then deliver the code ourselves via Google Workspace SMTP.
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error) return NextResponse.json({ ok: true, message: GENERIC }); // e.g. no such user → stay generic

  const code = data?.properties?.email_otp;
  if (code) {
    try { await sendMail({ to: email, ...passwordResetEmail({ code }) }); } catch { /* never leak send failures */ }
  }
  return NextResponse.json({ ok: true, message: GENERIC });
}
