# Transactional email (SMTP)

Welcome and order-confirmation emails, sent via your own mailbox over SMTP (nodemailer).

## What was built

- `lib/mailer.js` — `sendMail()` (never throws; no-op when SMTP is unset), `verifyMailer()`, `mailerConfigured()`.
- `lib/email-templates.js` — branded, inline-styled `welcomeEmail()` and `orderConfirmationEmail()`.
- Hooks:
  - **Welcome email** → `app/api/auth/signup` after a successful signup.
  - **Order confirmation** → `app/api/orders` (COD / built-in) **and** `app/api/razorpay/verify` (prepaid).
- Admin diagnostic — `POST /api/admin/mail-test` (staff-guarded) + a **“Send test email”** button in
  Settings → *Transactional email (SMTP)*.

All email sends are wrapped so a mail failure never blocks signup or an order.

## Setup (you do this — never committed)

Add to `.env.local`, then restart the server:

```
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587            # 465 for implicit TLS/SSL; 587 for STARTTLS
SMTP_USER=you@yourdomain.com
SMTP_PASS=your-smtp-password-or-app-password
SMTP_FROM=Suddhalaya <you@yourdomain.com>   # optional; defaults to SMTP_USER
```

Common providers:
- **Gmail / Google Workspace** — host `smtp.gmail.com`, port `587`, user = full address, pass = a
  16-char **App Password** (not your login password; requires 2-Step Verification).
- **Zoho Mail** — host `smtp.zoho.in`, port `465` (secure) or `587`.
- **Microsoft 365** — host `smtp.office365.com`, port `587`.

## Verify

1. Add the vars, restart.
2. Admin → **Settings → Transactional email (SMTP)** → enter your address → **Send test email**.
3. A ✓ confirms the connection and delivery. Then a real signup / order will send automatically.

Until SMTP is configured, signup and checkout work exactly as before — the email step is skipped.
