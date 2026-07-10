import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Current staff session (restores admin state across refreshes).
export async function GET() {
  if (!isConfigured()) return NextResponse.json({ configured: false, staff: null });
  const db = await getServerSupabase();
  const { data } = await db.auth.getUser();
  if (!data?.user) return NextResponse.json({ configured: true, staff: null });
  const { data: staff } = await db.from("staff").select("role,name,active").eq("user_id", data.user.id).maybeSingle();
  return NextResponse.json({
    configured: true,
    staff: staff && staff.active ? { name: staff.name || data.user.email, role: staff.role } : null,
  });
}
