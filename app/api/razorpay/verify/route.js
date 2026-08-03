import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { getAdminSupabase, hasServiceRole } from "@/lib/supabase/admin";
import { razorpayConfigured, verifyRazorpaySignature } from "@/lib/razorpay";
import { sendMail } from "@/lib/mailer";
import { orderConfirmationEmail } from "@/lib/email-templates";

export const dynamic = "force-dynamic";

// POST /api/razorpay/verify — verify the checkout signature, then create the order
// server-side (authoritative pricing/stock) ONLY after the payment is confirmed,
// and stamp the real Razorpay payment id on it.
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

  // Record the real Razorpay ids on the created order (server-only, post-verification).
  try {
    if (data && data.order_no && hasServiceRole()) {
      const admin = getAdminSupabase();
      await admin
        .from("orders")
        .update({
          payment_status: "paid",
          payment_txn_id: razorpay_payment_id,
          payment_gateway: "Razorpay",
        })
        .eq("order_no", data.order_no);
    }
  } catch {
    /* order is placed + paid; id-stamping is best-effort */
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

  return NextResponse.json({ ...data, ok: true, razorpay_payment_id });
}
