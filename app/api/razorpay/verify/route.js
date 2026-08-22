import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { getAdminSupabase, hasServiceRole } from "@/lib/supabase/admin";
import { razorpayConfigured, verifyRazorpaySignature } from "@/lib/razorpay";
import { sendMail } from "@/lib/mailer";
import { orderConfirmationEmail } from "@/lib/email-templates";

export const dynamic = "force-dynamic";

// POST /api/razorpay/verify — verify the checkout signature, create the order
// server-side (authoritative pricing/stock) ONLY after the payment is confirmed, then
// mark it paid and issue its invoice via mark_order_paid(). This route is the only
// path by which an order can become `paid`.
//
// Known remaining gap (audit BUG-01, roadmap phase 1): this whole sequence still runs
// inside the customer's browser session. If place_order throws after capture — a race
// for the last unit, a product drafted mid-checkout — the customer is charged with no
// order. Closing that needs the Razorpay webhook and a payment_intents ledger.
export async function POST(req) {
  if (!razorpayConfigured()) return NextResponse.json({ ok: false, configured: false });
  if (!isConfigured()) return NextResponse.json({ ok: false, err: "Backend not configured." });

  const body = await req.json().catch(() => ({}));
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
  if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return NextResponse.json({ ok: false, err: "Payment verification failed." });
  }

  // Signature valid — place the order (RPC recomputes pricing + deducts stock).
  const db = await getServerSupabase();
  const { data, error } = await db.rpc("place_order", {
    p_items: body.items || [],
    p_customer: body.customer || {},
    p_ship: body.ship || {},
    p_payment_method: body.payment_method || "upi",
    p_coupon: body.coupon || null,
  });
  if (error) return NextResponse.json({ ok: false, err: error.message });

  // Audit BUG-02/BUG-07: place_order now creates every order pending. This is the
  // step that actually makes it paid and issues its GST invoice number, and it runs
  // only after the HMAC signature above has been verified. It is NOT best-effort —
  // the customer has already been charged, so a failure here must be surfaced with
  // the order number rather than swallowed.
  let paid = null;
  if (!hasServiceRole()) {
    return NextResponse.json({
      ok: false,
      order_no: data?.order_no,
      err: "Payment received but the order could not be confirmed automatically. Please contact support quoting " + (data?.order_no || razorpay_payment_id) + ".",
    });
  }
  try {
    const admin = getAdminSupabase();
    const { data: mp, error: mpErr } = await admin.rpc("mark_order_paid", {
      p_order_no: data.order_no,
      p_txn_id: razorpay_payment_id,
      p_gateway: "Razorpay",
    });
    if (mpErr) throw mpErr;
    paid = mp;
  } catch (e) {
    console.error("[razorpay/verify] mark_order_paid failed", {
      order_no: data?.order_no,
      razorpay_payment_id,
      error: String(e?.message || e),
    });
    return NextResponse.json({
      ok: false,
      order_no: data?.order_no,
      err: "Your payment went through, but we could not confirm the order automatically. Please contact support quoting " + (data?.order_no || razorpay_payment_id) + " — we have a record of your payment.",
    });
  }

  // Order-confirmation email (no-op without SMTP; never fails the order)
  try {
    const email = (body.customer && body.customer.email) || "";
    if (data && data.order_no && email) {
      const t = orderConfirmationEmail({
        name: (body.customer && body.customer.name) || "", orderNo: data.order_no, total: data.total,
        paymentStatus: "paid", paymentMethod: body.payment_method || "upi",
        ship: body.ship || {}, items: body.items || [],
      });
      await sendMail({ to: email, ...t });
    }
  } catch {}

  // Merge the post-payment state over the pending order place_order returned, so the
  // confirmation screen shows "paid" and the real invoice number.
  return NextResponse.json({
    ...data,
    ok: true,
    razorpay_payment_id,
    payment_status: "paid",
    status: paid?.status || "processing",
    invoice: paid?.invoice || null,
  });
}
