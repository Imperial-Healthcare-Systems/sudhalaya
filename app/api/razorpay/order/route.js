import { NextResponse } from "next/server";
import { razorpayConfigured, razorpayKeyId, createRazorpayOrder } from "@/lib/razorpay";

export const dynamic = "force-dynamic";

// POST /api/razorpay/order — create a Razorpay order for the cart total.
// Returns { configured:false } when keys are absent so the storefront can fall
// back to its built-in (simulated) checkout without breaking.
export async function POST(req) {
  if (!razorpayConfigured()) return NextResponse.json({ ok: false, configured: false });
  const body = await req.json().catch(() => ({}));
  const rupees = Number(body.amount);
  const amountPaise = Math.round(rupees * 100);
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    return NextResponse.json({ ok: false, err: "Invalid amount" });
  }
  try {
    const order = await createRazorpayOrder(amountPaise, (body.receipt || "").slice(0, 40), {
      email: body.email || "",
    });
    return NextResponse.json({
      ok: true,
      configured: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: razorpayKeyId(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, err: String(e?.message || e) });
  }
}
