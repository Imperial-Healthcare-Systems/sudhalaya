import nodemailer from "nodemailer";

// SMTP transactional mail. Credentials live in .env.local (never committed):
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_FROM (optional)
// When unset, sendMail() is a no-op that reports { skipped:true } so signup/checkout
// never fail because email isn't configured yet.

export function mailerConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let _tx = null;
function transport() {
  if (_tx) return _tx;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  _tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // implicit TLS on 465; STARTTLS otherwise
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _tx;
}

function fromAddress() {
  return process.env.SMTP_FROM || `Suddhalaya <${process.env.SMTP_USER}>`;
}

// Never throws — returns a result object. Callers can fire-and-forget.
export async function sendMail({ to, subject, html, text }) {
  if (!mailerConfigured()) return { ok: false, skipped: true, reason: "SMTP not configured" };
  if (!to) return { ok: false, err: "No recipient" };
  try {
    const info = await transport().sendMail({ from: fromAddress(), to, subject, html, text: text || undefined });
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
}

// One-off SMTP connectivity check (used by an admin diagnostic route).
export async function verifyMailer() {
  if (!mailerConfigured()) return { ok: false, skipped: true, reason: "SMTP not configured" };
  try {
    await transport().verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
}
