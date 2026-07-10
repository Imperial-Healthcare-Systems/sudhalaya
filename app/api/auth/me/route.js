import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isConfigured()) return NextResponse.json({ configured: false, user: null });
  const db = await getServerSupabase();
  const { data } = await db.auth.getUser();
  const u = data?.user;
  return NextResponse.json({
    configured: true,
    user: u ? { name: u.user_metadata?.full_name || "", email: u.email, phone: u.user_metadata?.phone || "" } : null,
  });
}
