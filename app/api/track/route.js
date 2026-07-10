import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const VALID = new Set(["view", "product", "cart", "order"]);

// Fire-and-forget on-site analytics event.
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const { evt } = await req.json().catch(() => ({}));
  if (!VALID.has(evt)) return NextResponse.json({ ok: false });
  const db = await getServerSupabase();
  await db.rpc("track_event", { p_evt: evt });
  return NextResponse.json({ ok: true });
}
