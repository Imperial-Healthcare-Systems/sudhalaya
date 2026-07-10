import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!isConfigured()) return NextResponse.json({ ok: true });
  const db = await getServerSupabase();
  await db.auth.signOut();
  return NextResponse.json({ ok: true });
}
