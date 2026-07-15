import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { batchToEngine, movementToEngine } from "@/lib/shape";

export const dynamic = "force-dynamic";

// GET /api/admin/inventory?variant_id=123   (or ?product_id=5 for all its variants)
// Returns batches (with warehouse) + recent stock movements. Staff-only via RLS.
export async function GET(req) {
  if (!isConfigured()) return NextResponse.json({ configured: false });
  const db = await getServerSupabase();
  const { data: userRes } = await db.auth.getUser();
  if (!userRes?.user) return NextResponse.json({ ok: false, err: "Not signed in." }, { status: 401 });
  const { data: staff } = await db.from("staff").select("active").eq("user_id", userRes.user.id).maybeSingle();
  if (!staff?.active) return NextResponse.json({ ok: false, err: "Not authorized." }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const variantId = searchParams.get("variant_id");
  const productId = searchParams.get("product_id");

  let variantIds = [];
  if (variantId) variantIds = [Number(variantId)];
  else if (productId) {
    const { data: vs } = await db.from("product_variants").select("id").eq("product_id", Number(productId));
    variantIds = (vs || []).map((v) => v.id);
  }
  if (!variantIds.length) return NextResponse.json({ ok: true, batches: [], movements: [] });

  const [batches, movements] = await Promise.all([
    db.from("inventory_batches").select("*, warehouses(id,name,code)").in("variant_id", variantIds).order("mfg_date", { ascending: true }),
    db.from("stock_movements").select("*").in("variant_id", variantIds).order("created_at", { ascending: false }).limit(50),
  ]);
  if (batches.error) return NextResponse.json({ ok: false, err: batches.error.message });

  return NextResponse.json({
    ok: true,
    batches: (batches.data || []).map(batchToEngine),
    movements: (movements.data || []).map(movementToEngine),
  });
}
