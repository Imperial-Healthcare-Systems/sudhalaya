import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { sendMail, verifyMailer, mailerConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

// Staff-guarded SMTP diagnostic: verifies the connection and sends a test email.
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const db = await getServerSupabase();
  const { data: userRes } = await db.auth.getUser();
  if (!userRes?.user) return NextResponse.json({ ok: false, err: "Not signed in." }, { status: 401 });
  const { data: staff } = await db.from("staff").select("role,active").eq("user_id", userRes.user.id).maybeSingle();
  if (!staff || !staff.active) return NextResponse.json({ ok: false, err: "Not authorized." }, { status: 403 });

  if (!mailerConfigured()) {
    return NextResponse.json({ ok: false, configured: false, err: "SMTP is not configured. Add SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS to .env.local." });
  }

  const body = await req.json().catch(() => ({}));
  const to = (body.to || userRes.user.email || "").trim();
  if (!to) return NextResponse.json({ ok: false, err: "No recipient." });

  const conn = await verifyMailer();
  if (!conn.ok) return NextResponse.json({ ok: false, err: "SMTP connection failed: " + (conn.err || "unknown") });

  const res = await sendMail({
    to,
    subject: "Suddhalaya — SMTP test ✓",
    html: `<p style="font-family:sans-serif">Your Suddhalaya transactional email is working. This is a test message sent from the admin console.</p>`,
    text: "Your Suddhalaya transactional email is working. This is a test message sent from the admin console.",
  });
  return res.ok
    ? NextResponse.json({ ok: true, to, id: res.id })
    : NextResponse.json({ ok: false, err: res.err || "Send failed" });
}
