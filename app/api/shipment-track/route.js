import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { trackShipment } from "@/lib/ekart";

export const dynamic = "force-dynamic";

// GET /api/shipment-track?awb=XYZ — live Ekart tracking for one of the shopper's orders.
export async function POST(req) {
  return handle(req);
}
export async function GET(req) {
  return handle(req);
}

async function handle(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const db = await getServerSupabase();
  const { data: userRes } = await db.auth.getUser();
  if (!userRes?.user) return NextResponse.json({ ok: false, err: "Please sign in to track your shipment." }, { status: 401 });

  let awb = "";
  try {
    if (req.method === "POST") { awb = (await req.json().catch(() => ({}))).awb || ""; }
    else { awb = new URL(req.url).searchParams.get("awb") || ""; }
  } catch { /* ignore */ }
  awb = (awb || "").trim();
  if (!awb) return NextResponse.json({ ok: false, err: "No tracking number." });

  // RLS on `orders` scopes reads to the signed-in shopper's own orders
  // (user_id = auth.uid()); match the AWB among those to confirm ownership.
  const { data: orders } = await db.from("orders").select("order_no, status, tracking");
  const order = (orders || []).find((o) => (o.tracking || "").trim() === awb);
  if (!order) return NextResponse.json({ ok: false, err: "No shipment found for that tracking number on your account." });

  const res = await trackShipment(awb);
  return NextResponse.json({ ...res, order_no: order.order_no, order_status: order.status });
}
