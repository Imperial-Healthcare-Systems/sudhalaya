// Suddhalaya — database seeder.
// Usage:  node supabase/seed.mjs
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:     SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (creates an owner staff login)
// Idempotent: safe to re-run (upserts by natural keys).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { PRODUCTS, CATEGORIES, COUPONS, CUSTOMERS, ORDERS } from "./seed-data.mjs";

// load .env.local / .env if present (no dependency)
for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local");
  process.exit(1);
}
const db = createClient(URL_, KEY, { auth: { persistSession: false } });

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---- defaults that mirror the engine's SETTINGS / CMS ----
const SETTINGS = {
  storeName: "Suddhalaya", supportEmail: "support@suddhalaya.com",
  freeShipThreshold: 999, flatShip: 60, codEnabled: true, codMaxOrder: 0,
  gstin: "29ABCDE1234F1Z5", invoicePrefix: "INV-2026-",
  notifyEmail: true, notifySms: false, notifyWhatsapp: false,
};
const CMS = {
  announcement: "Free shipping over ₹999 · 100% pure, lab-tested staples",
  returnPolicy: "7-day easy returns on unopened items.",
  heroEyebrow: "Farm-to-Home · Certified Organic",
  heroHeadline: "Purity you can <em>taste</em>, traceability you can trust.",
  heroLead: "From bilona-churned A2 ghee to wood-pressed oils and raw forest honey — every Suddhalaya batch is lab-tested and traceable to its source.",
  storyEyebrow: "Our Story",
  storyHeading: 'Born from a simple frustration with "organic" labels.',
  storyP1: "We started Suddhalaya because the word organic had lost its meaning — printed on packets with no proof behind it. We wanted food we could trace back to the soil, the cow, the hive.",
  storyP2: "So we built direct relationships with small farms, brought back slow traditional methods, and put a lab report behind every batch.",
  heroImage: "", storyImage: "", logo: "",
};
const HOME_REVIEWS = [
  { body: "The ghee genuinely smells like my grandmother's kitchen. You can tell it's the real bilona method.", name: "Ananya Rao", location: "Bengaluru", rating: 5, verified: true },
  { body: "Switched our whole kitchen to Suddhalaya oils. The lab reports gave me the confidence no other brand did.", name: "Vikram Shetty", location: "Pune", rating: 5, verified: true },
  { body: "Raw honey that actually crystallises naturally — that's how you know it's unprocessed. Beautiful.", name: "Meera Krishnan", location: "Chennai", rating: 5, verified: true },
];

async function must(label, promise) {
  const { error, data } = await promise;
  if (error) { console.error(`✗ ${label}:`, error.message); throw error; }
  console.log(`✓ ${label}`);
  return data;
}

async function main() {
  console.log("Seeding Suddhalaya →", URL_);

  // config
  await must("app_config: settings", db.from("app_config").upsert({ key: "settings", value: SETTINGS }));
  await must("app_config: cms", db.from("app_config").upsert({ key: "cms", value: CMS }));

  // categories
  await must("categories", db.from("categories").upsert(
    CATEGORIES.map((c) => ({ name: c.name, slug: c.slug, seo: c.seo, sort_order: c.order, active: true })),
    { onConflict: "slug" }
  ));

  // coupons
  await must("coupons", db.from("coupons").upsert(
    Object.entries(COUPONS).map(([code, c]) => ({
      code, type: c.type, value: c.value, description: c.desc, active: c.active,
      uses: c.uses || 0, cap: c.cap || 0, min_cart: c.minCart || 0,
      expires: c.expires ? new Date(c.expires).toISOString().slice(0, 10) : null,
    })),
    { onConflict: "code" }
  ));

  // products + variants
  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    const row = {
      sku: p.sku, name: p.name, category: p.cat, rating: p.rating, review_count: p.reviews,
      tag: p.tag || "", type: p.type || "jar", color1: p.c1, color2: p.c2, gst: p.gst, hsn: p.hsn || null,
      ship_fee: p.shipFee || 0, amazon_url: p.amazonUrl || "", description: p.desc || "",
      seo_title: p.seoTitle || p.name, feats: p.feats || [], content: p.content || {},
      faqs: p.faqs || [], draft: !!p.draft, sort_order: i,
    };
    const prod = await must(`product: ${p.name}`,
      db.from("products").upsert(row, { onConflict: "sku" }).select("id").single());
    await must(`  variants: ${p.sku}`, db.from("product_variants").upsert(
      (p.variants || []).map((v, vi) => ({
        product_id: prod.id, label: v.label, sku: v.sku, price: v.price, mrp: v.mrp,
        stock: v.stock, sort_order: vi,
      })),
      { onConflict: "sku" }
    ));
  }

  // customers
  await must("customers", db.from("customers").upsert(
    CUSTOMERS.map((c) => ({ name: c.name, email: c.email, phone: c.phone, city: c.city, since: c.since, tags: c.tags || [] })),
    { onConflict: "email" }
  ));

  // home reviews (only if empty, to avoid dupes on re-run)
  const { count: hrCount } = await db.from("home_reviews").select("*", { count: "exact", head: true });
  if (!hrCount) await must("home_reviews", db.from("home_reviews").insert(HOME_REVIEWS));
  else console.log("• home_reviews already present, skipping");

  // sample orders (+ items + events) — only if none present
  const { count: oCount } = await db.from("orders").select("*", { count: "exact", head: true });
  if (!oCount) {
    for (const o of ORDERS) {
      const gross = o.lines.reduce((s, l) => s + l.price * l.qty, 0);
      const tax = round2(o.lines.reduce((s, l) => { const g = l.price * l.qty; return s + (g - g / (1 + (l.gst || 0) / 100)); }, 0));
      const base = round2(gross - tax);
      const total = round2(base + tax + (o.shipTotal || 0));
      const order = await must(`order: ${o.id}`, db.from("orders").insert({
        order_no: o.id, customer_name: o.customer, email: o.email, phone: o.phone,
        ship_name: o.ship?.name, ship_line: o.ship?.line, ship_city: o.ship?.city,
        ship_state: o.ship?.state, ship_pin: o.ship?.pin,
        payment_method: o.payment?.method, payment_status: o.payment?.status,
        payment_txn_id: o.payment?.txnId || "", payment_gateway: o.payment?.gateway || "",
        payment_captured_at: o.payment?.capturedAt || "",
        subtotal: base, tax_total: tax, ship_total: o.shipTotal || 0, total,
        status: o.status, tracking: o.tracking || null,
      }).select("id").single());
      await db.from("order_items").insert(o.lines.map((l) => ({
        order_id: order.id, sku: l.sku, name: l.name, variant: l.variant, qty: l.qty, price: l.price, gst: l.gst || 0,
      })));
      await db.from("order_events").insert((o.timeline || []).map((t) => ({
        order_id: order.id, at: t.t, actor: t.actor, note: t.note,
      })));
    }
  } else console.log("• orders already present, skipping");

  // optional owner staff login
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPass = process.env.SEED_ADMIN_PASSWORD;
  if (adminEmail && adminPass) {
    const { data: created, error } = await db.auth.admin.createUser({
      email: adminEmail, password: adminPass, email_confirm: true,
      user_metadata: { full_name: "Store Owner" },
    });
    if (error && !/already/i.test(error.message)) console.error("✗ admin user:", error.message);
    let uid = created?.user?.id;
    if (!uid) { const { data: list } = await db.auth.admin.listUsers(); uid = list?.users?.find((u) => u.email === adminEmail)?.id; }
    if (uid) {
      await must("staff: owner", db.from("staff").upsert({ user_id: uid, name: "Store Owner", email: adminEmail, role: "owner", active: true }));
    }
  } else {
    console.log("• SEED_ADMIN_EMAIL/PASSWORD not set — skipping owner staff creation");
  }

  console.log("\nDone. Catalog, config, customers and sample orders seeded.");
}

main().catch((e) => { console.error(e); process.exit(1); });
