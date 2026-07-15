import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };

// POST /api/admin/upload  { dataUrl, filename }  -> uploads to the product-images
// bucket and returns a public URL. Staff-guarded; upload via service role.
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });

  // staff check via the session client (RLS-style gate)
  const sdb = await getServerSupabase();
  const { data: userRes } = await sdb.auth.getUser();
  if (!userRes?.user) return NextResponse.json({ ok: false, err: "Not signed in." }, { status: 401 });
  const { data: staff } = await sdb.from("staff").select("active").eq("user_id", userRes.user.id).maybeSingle();
  if (!staff?.active) return NextResponse.json({ ok: false, err: "Not authorized." }, { status: 403 });

  const { dataUrl, filename } = await req.json().catch(() => ({}));
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!m) return NextResponse.json({ ok: false, err: "Invalid image data." });
  const contentType = m[1];
  const ext = EXT[contentType];
  if (!ext) return NextResponse.json({ ok: false, err: "Unsupported image type." });
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) return NextResponse.json({ ok: false, err: "Image too large (max 5 MB)." });

  const safe = (filename || "image").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "image";
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}.${ext}`;

  const admin = getAdminSupabase();
  const { error } = await admin.storage.from("product-images").upload(path, buffer, { contentType, upsert: false });
  if (error) return NextResponse.json({ ok: false, err: error.message });
  const { data } = admin.storage.from("product-images").getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl, path });
}
