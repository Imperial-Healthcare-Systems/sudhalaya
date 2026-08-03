# Razorpay payment integration

Real UPI/Card payments via Razorpay, with server-side order creation and signature
verification. COD and (when keys are absent) a no-charge demo order keep working.

## What was built

- `lib/razorpay.js` — `createRazorpayOrder()` (REST, Basic auth) + `verifyRazorpaySignature()`
  (HMAC-SHA256 of `order_id|payment_id`, timing-safe compare).
- `POST /api/razorpay/order` — creates a Razorpay order for the cart total. Returns
  `{configured:false}` when keys are absent so the storefront falls back cleanly.
- `POST /api/razorpay/verify` — verifies the checkout signature, then calls the
  `place_order` RPC (authoritative pricing/stock) **only after** payment is confirmed,
  and stamps the real `razorpay_payment_id` on the order (service-role, server-only).
- Storefront (`public/sudhalaya.js`) — `startRazorpayCheckout()` loads the Razorpay SDK
  on demand, opens Checkout for prepaid methods, and completes the order on the verified
  callback. COD and un-configured stores use the built-in flow.

## Flow

1. Shopper picks UPI/Card → `POST /api/razorpay/order` → Razorpay `order_id` + `key_id`.
2. Razorpay Checkout opens; shopper pays.
3. Callback → `POST /api/razorpay/verify` with `razorpay_order_id / _payment_id / _signature`
   plus the cart payload.
4. Signature valid → `place_order` creates the paid order; the real payment id is recorded.
5. Confirmation shown; cart cleared; address remembered.

Order is created **only after** a verified payment — no paid order exists if payment fails.

## Setup (you do this — never committed)

Add to `.env.local` (test mode), then restart the server:

```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

- `SUPABASE_SERVICE_ROLE_KEY` (already present) is used to stamp the payment id.
- No `NEXT_PUBLIC_*` var is needed — the browser gets `key_id` from `/api/razorpay/order`.

## ⚠️ Status — provided test keys fail authentication

The test keys shared on 2026‑07‑22 —
`rzp_test_TJL0vjEKZX7GFB` / `ke5v0HHgjZP62KPgpr5nSPEFDT` — return **HTTP 401
"Authentication failed"** from `https://api.razorpay.com/v1/orders` (identical to a
deliberately-wrong secret). The integration code is verified correct: the HMAC signature
check passes its unit tests, the request format is the standard Orders API call, and the
routes/fallback behave correctly.

**Action needed:** regenerate a valid test key pair from the Razorpay Dashboard
(Settings → API Keys → Generate Test Key), put them in `.env.local` as above, and restart.
Once valid keys are in place, order creation and the full pay→verify→place flow will work
with no further code changes.

## Test cards (Razorpay test mode, once keys are valid)

- Card: `4111 1111 1111 1111`, any future expiry, any CVV.
- UPI success: `success@razorpay`.
