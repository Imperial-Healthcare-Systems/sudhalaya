import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { getAdminSupabase, hasServiceRole } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" };

// POST /api/review-image { dataUrl } — a signed-in shopper uploads a review photo.
// Stored (via service role) in the public product-images bucket under reviews/.
export async function POST(req) {
  if (!isConfigured() || !hasServiceRole()) return NextResponse.json({ ok: false, configured: false });

  const db = await getServerSupabase();
  const { data: userRes } = await db.auth.getUser();
  if (!userRes?.user) return NextResponse.json({ ok: false, err: "Please sign in to add a photo." }, { status: 401 });

  const { dataUrl } = await req.json().catch(() => ({}));
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!m) return NextResponse.json({ ok: false, err: "Invalid image." });
  const contentType = m[1];
  const ext = EXT[contentType];
  if (!ext) return NextResponse.json({ ok: false, err: "Unsupported image type (use PNG/JPG/WebP)." });
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) return NextResponse.json({ ok: false, err: "Image too large (max 5 MB)." });

  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const path = `reviews/${hash}.${ext}`;

  const admin = getAdminSupabase();
  const up = await admin.storage.from("product-images").upload(path, buffer, { contentType, upsert: true });
  if (up.error) return NextResponse.json({ ok: false, err: up.error.message });
  const { data } = admin.storage.from("product-images").getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl });
}
