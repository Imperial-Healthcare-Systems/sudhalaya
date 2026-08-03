import crypto from "crypto";

// Razorpay server helpers. Keys live in .env.local (never committed):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
// key_id is safe to expose to the browser; key_secret is server-only.

export function razorpayConfigured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function razorpayKeyId() {
  return process.env.RAZORPAY_KEY_ID || "";
}

// Create a Razorpay order via the REST API (HTTP Basic auth). amountPaise is an integer.
export async function createRazorpayOrder(amountPaise, receipt, notes) {
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      receipt: receipt || undefined,
      notes: notes || {},
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.description || "Razorpay order creation failed");
  return data;
}

// Verify the checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret).
export function verifyRazorpaySignature(orderId, paymentId, signature) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
