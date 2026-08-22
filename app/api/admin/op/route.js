import { NextResponse } from "next/server";
import { getServerSupabase, isConfigured } from "@/lib/supabase/server";
import { sendMail } from "@/lib/mailer";
import { backInStockEmail } from "@/lib/email-templates";

export const dynamic = "force-dynamic";

// After receiving stock: if the product is back in stock, email the waitlist and clear it.
async function notifyBackInStock(db, variantId) {
  try {
    const { data: variant } = await db
      .from("product_variants")
      .select("product_id, products(sku, name)")
      .eq("id", variantId)
      .maybeSingle();
    const psku = variant?.products?.sku;
    if (!psku) return;
    const { data: sib } = await db.from("product_variants").select("stock").eq("product_id", variant.product_id);
    const total = (sib || []).reduce((s, v) => s + (v.stock || 0), 0);
    if (total <= 0) return;
    const { data: waiters } = await db
      .from("stock_notifications")
      .select("id,email")
      .eq("product_sku", psku)
      .eq("notified", false);
    if (!waiters || !waiters.length) return;
    const t = backInStockEmail({ name: variant.products.name });
    for (const w of waiters) { try { await sendMail({ to: w.email, ...t }); } catch {} }
    await db.from("stock_notifications").update({ notified: true }).in("id", waiters.map((w) => w.id));
  } catch {
    /* best-effort — never block the stock receipt on the waitlist email */
  }
}

// Map an engine product object to the products table columns.
function productColumns(p) {
  return {
    sku: p.sku, name: p.name, category: p.cat, rating: p.rating ?? 0, review_count: p.reviews ?? 0,
    tag: p.tag || "", type: p.type || "jar", color1: p.c1 ?? null, color2: p.c2 ?? null,
    gst: p.gst ?? 0, hsn: p.hsn || null, ship_fee: p.shipFee || 0, amazon_url: p.amazonUrl || "",
    low_stock_threshold: Number.isFinite(+p.lowStock) ? Math.max(0, parseInt(p.lowStock)) : 10,
    description: p.desc || "", seo_title: p.seoTitle || p.name, feats: p.feats || [],
    content: p.content || {}, faqs: p.faqs || [], image_urls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
    draft: !!p.draft,
  };
}

// All admin writes go through here. The staff session client means Row-Level
// Security enforces per-role permissions (has_perm) on every statement.
export async function POST(req) {
  if (!isConfigured()) return NextResponse.json({ ok: false, configured: false });
  const db = await getServerSupabase();

  const { data: userRes } = await db.auth.getUser();
  if (!userRes?.user) return NextResponse.json({ ok: false, err: "Not signed in." }, { status: 401 });
  const { data: staff } = await db.from("staff").select("role,active").eq("user_id", userRes.user.id).maybeSingle();
  if (!staff || !staff.active) return NextResponse.json({ ok: false, err: "Not authorized." }, { status: 403 });

  const { op, payload } = await req.json().catch(() => ({}));
  const fail = (e) => NextResponse.json({ ok: false, err: e?.message || String(e) });

  try {
    switch (op) {
      case "config.set": {
        const { error } = await db.from("app_config").upsert({ key: payload.key, value: payload.value });
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      case "product.upsert": {
        const p = payload.product;
        const { data: prod, error } = await db.from("products")
          .upsert(productColumns(p), { onConflict: "sku" }).select("id").single();
        if (error) return fail(error);
        const variants = (p.variants || []).map((v, i) => ({
          product_id: prod.id, label: v.label, sku: v.sku, price: v.price, mrp: v.mrp, stock: v.stock, sort_order: i,
          amazon_url: (v.amazonUrl || "").trim(),
        }));
        if (variants.length) {
          const { error: ve } = await db.from("product_variants").upsert(variants, { onConflict: "sku" });
          if (ve) return fail(ve);
          // remove variants that no longer exist on this product
          const keep = variants.map((v) => v.sku);
          await db.from("product_variants").delete().eq("product_id", prod.id).not("sku", "in", `(${keep.map((s) => `"${s}"`).join(",")})`);
        }
        return NextResponse.json({ ok: true, id: prod.id });
      }

      case "product.delete": {
        // Audit BUG-05: this backs the admin "Archive" button, whose dialog promises
        // the product is recoverable and order history intact. It used to run a hard
        // DELETE — and products cascade to product_variants, which cascade to
        // inventory_batches, so one click destroyed the whole batch/expiry/cost
        // ledger for that product. Unpublish instead: the storefront already filters
        // draft=true, and the admin list loads drafts so it stays recoverable.
        const { error } = await db.from("products").update({ draft: true }).eq("id", payload.id);
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      case "category.upsert": {
        const c = payload.category;
        const row = { name: c.name, slug: c.slug, seo: c.seo, sort_order: c.order ?? 0, active: c.active !== false, image_url: c.image || null };
        // Editing an existing category: update by its DB id so a slug change edits
        // the same row instead of upsert-by-slug inserting an orphaned duplicate.
        if (payload.matchId != null) {
          const { data, error } = await db.from("categories").update(row).eq("id", payload.matchId).select("id").maybeSingle();
          if (error) return fail(error);
          if (data) return NextResponse.json({ ok: true, id: data.id });
          // matchId not found (e.g. a brand-new row) → fall through to slug upsert
        }
        const { data, error } = await db.from("categories").upsert(row, { onConflict: "slug" }).select("id").single();
        return error ? fail(error) : NextResponse.json({ ok: true, id: data.id });
      }

      case "category.delete": {
        const q = payload.id ? db.from("categories").delete().eq("id", payload.id)
                             : db.from("categories").delete().eq("slug", payload.slug);
        const { error } = await q;
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      case "coupon.upsert": {
        const c = payload.coupon;
        const row = {
          code: c.code, type: c.type, value: c.value, description: c.desc, active: c.active !== false,
          cap: c.cap || 0, min_cart: c.minCart || 0,
          expires: c.expires ? new Date(c.expires).toISOString().slice(0, 10) : null,
          // Phase 4.2: targeting
          scope: c.scope || "all",
          product_skus: Array.isArray(c.productSkus) ? c.productSkus : [],
          user_emails: Array.isArray(c.userEmails) ? c.userEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean) : [],
          per_user_limit: c.perUserLimit || 0,
        };
        const { error } = await db.from("coupons").upsert(row, { onConflict: "code" });
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      case "coupon.toggle": {
        const { data: cur } = await db.from("coupons").select("active").eq("code", payload.code).maybeSingle();
        const { error } = await db.from("coupons").update({ active: !(cur?.active) }).eq("code", payload.code);
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      case "coupon.delete": {
        const { error } = await db.from("coupons").delete().eq("code", payload.code);
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      case "return.upsert": {
        const r = payload.return;
        const row = {
          id: r.id, order_no: r.orderId, customer: r.customer, sku: r.sku, reason: r.reason,
          status: r.status, refund: r.refund || 0, date: r.date, restock: !!r.restock,
        };
        const { error } = await db.from("returns").upsert(row, { onConflict: "id" });
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      case "payment.capture": {
        const { data: o, error: oe } = await db.from("orders").select("id").eq("order_no", payload.orderNo).maybeSingle();
        if (oe || !o) return fail(oe || new Error("Order not found"));
        const upd = {
          payment_status: "paid",
          payment_txn_id: payload.txnId || "",
          payment_gateway: payload.gateway || "Razorpay",
          payment_captured_at: payload.capturedAt || "",
        };
        if (payload.invoice) upd.payment_invoice = payload.invoice;
        if (payload.status) upd.status = payload.status;
        const { error } = await db.from("orders").update(upd).eq("id", o.id);
        if (error) return fail(error);
        if (payload.note) await db.from("order_events").insert({ order_id: o.id, at: payload.at || "", actor: payload.actor || "admin", note: payload.note });
        return NextResponse.json({ ok: true });
      }

      case "order.status": {
        const { data: o, error: oe } = await db.from("orders").select("id").eq("order_no", payload.orderNo).maybeSingle();
        if (oe || !o) return fail(oe || new Error("Order not found"));
        const upd = { status: payload.status };
        if (payload.tracking) upd.tracking = payload.tracking;
        if (payload.paymentStatus) upd.payment_status = payload.paymentStatus;
        const { error } = await db.from("orders").update(upd).eq("id", o.id);
        if (error) return fail(error);
        if (payload.note) await db.from("order_events").insert({ order_id: o.id, at: payload.at || "", actor: payload.actor || "admin", note: payload.note });
        // restock returned units back into batches (Phase 4.1) via restock_batch
        if (Array.isArray(payload.restock)) {
          for (const r of payload.restock) {
            const { data: v } = await db.from("product_variants").select("id").eq("sku", r.sku).maybeSingle();
            if (v) await db.rpc("restock_batch", { p_variant_id: v.id, p_qty: r.qty, p_order_no: payload.orderNo || null, p_actor: payload.actor || "admin" });
          }
        }
        return NextResponse.json({ ok: true });
      }

      // ---- Phase 4.1: warehouses + batches ----
      case "warehouse.upsert": {
        const w = payload.warehouse;
        if (w.isDefault) await db.from("warehouses").update({ is_default: false }).eq("is_default", true);
        const row = {
          name: w.name, code: w.code, city: w.city || null, state: w.state || null,
          pincode: w.pincode || null, address: w.address || null,
          active: w.active !== false, is_default: !!w.isDefault,
        };
        const { data, error } = await db.from("warehouses").upsert(row, { onConflict: "code" }).select("id").single();
        return error ? fail(error) : NextResponse.json({ ok: true, id: data.id });
      }

      case "warehouse.delete": {
        // soft-deactivate (batches may reference it) — matches the UI's "deactivate"
        const q = payload.id ? db.from("warehouses").update({ active: false }).eq("id", payload.id)
                             : db.from("warehouses").update({ active: false }).eq("code", payload.code);
        const { error } = await q;
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      case "batch.receive": {
        const p = payload;
        const { data, error } = await db.rpc("receive_stock", {
          p_variant_id: p.variantId, p_warehouse_id: p.warehouseId, p_batch_no: p.batchNo,
          p_mfg_date: p.mfgDate, p_expiry_date: p.expiryDate || null,
          p_qty: p.qty, p_cost_price: p.costPrice ?? null, p_actor: p.actor || "admin",
          // stock-in source -> audit reason (receive | return_restock | adjustment)
          p_reason: p.reason || "receive",
        });
        if (error) return fail(error);
        await notifyBackInStock(db, p.variantId);   // email the back-in-stock waitlist
        return NextResponse.json({ ok: true, batch_id: data });
      }

      case "batch.adjust": {
        const p = payload;
        const { error } = await db.rpc("adjust_batch", {
          p_batch_id: p.batchId, p_new_remaining: p.newRemaining,
          p_reason: p.reason || "adjustment", p_actor: p.actor || "admin", p_note: p.note || null,
        });
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      case "batch.transfer": {
        const p = payload;
        const { error } = await db.rpc("transfer_stock", {
          p_batch_id: p.batchId, p_to_warehouse_id: p.toWarehouseId, p_qty: p.qty, p_actor: p.actor || "admin",
        });
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      // ---- Client QA r2: review moderation (staff-guarded via RLS) ----
      case "review.approve": {
        const table = payload.kind === "home" ? "home_reviews" : "product_reviews";
        const { error } = await db.from(table).update({ approved: true }).eq("id", payload.id);
        return error ? fail(error) : NextResponse.json({ ok: true });
      }
      case "review.reject":
      case "review.delete": {
        // reject = remove a pending review; delete = remove an already-published one.
        // Both are a hard delete of the row by id (staff-guarded via RLS).
        const table = payload.kind === "home" ? "home_reviews" : "product_reviews";
        const { error } = await db.from(table).delete().eq("id", payload.id);
        return error ? fail(error) : NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ ok: false, err: "Unknown op: " + op });
    }
  } catch (e) {
    return fail(e);
  }
}
