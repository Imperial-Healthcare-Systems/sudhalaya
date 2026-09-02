import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/supabase/server";
import { getAdminSupabase, hasServiceRole } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/mailer";
import { passwordResetEmail } from "@/lib/email-templates";

export const dynamic = "force-dynamic";

const normPhone = (s) => { const d = (s || "").replace(/\D/g, "").slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : ""; };
// Client request: reset should clearly tell the user when no account exists for that
// email/mobile (rather than the security-first generic reply). Trade-off: this reveals
// which emails are registered (user-enumeration) — revert to a generic message if that
// matters more than the clearer UX.
const NO_ACCOUNT = "No account found with this email or mobile number. Please create an account to continue.";

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

  // No resolvable account → tell the user plainly (their request).
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, err: NO_ACCOUNT });

  // generateLink creates the recovery OTP server-side WITHOUT sending anything (it
  // errors if no such user) — we then deliver the code ourselves via SMTP.
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error) {
    if (error.status === 429 || /rate/i.test(error.message || "")) {
      return NextResponse.json({ ok: false, err: "Too many attempts — please wait a minute and try again." });
    }
    return NextResponse.json({ ok: false, err: NO_ACCOUNT });   // no such user
  }

  const code = data?.properties?.email_otp;
  if (code) {
    try { await sendMail({ to: email, ...passwordResetEmail({ code }) }); } catch { /* never leak send failures */ }
  }
  return NextResponse.json({ ok: true, message: "We've emailed a password reset code to your email." });
}
