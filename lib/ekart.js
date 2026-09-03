// Ekart shipment tracking.
//
// Configure via .env.local:
//   EKART_CLIENT_ID        (required — given: EKART_xxxxx)
//   EKART_API_SECRET       (bearer token / api key for the tracking API)
//   EKART_BASE_URL         (e.g. https://api.ekartlogistics.com)
//   EKART_TRACK_PATH       (e.g. /v2/shipments/{id}/track  — {id} is replaced by the AWB)
//   EKART_PUBLIC_TRACK_URL (public tracking page base; default below)
//
// Until the live API (base + path + secret) is configured, callers get a link-only
// result and the storefront shows a "Track on Ekart" button using the AWB.

const DEFAULT_PUBLIC = "https://app.elite.ekartlogistics.in/track/";

export function ekartConfigured() {
  return !!process.env.EKART_CLIENT_ID;
}
export function ekartApiReady() {
  return !!(process.env.EKART_CLIENT_ID && process.env.EKART_BASE_URL && process.env.EKART_TRACK_PATH);
}
// The authenticated APIs (create shipment, labels, serviceability, NDR) need a bearer
// token exchanged from the seller's Ekart login. Cached in-memory and refreshed ~1h
// before its 24h expiry.
let _ekartToken = { token: null, exp: 0 };
export function ekartAuthReady() {
  return !!(process.env.EKART_CLIENT_ID && process.env.EKART_USERNAME && process.env.EKART_PASSWORD);
}
export async function getEkartToken() {
  if (!ekartAuthReady()) return null;
  const now = Date.now();
  if (_ekartToken.token && now < _ekartToken.exp) return _ekartToken.token;
  const base = (process.env.EKART_BASE_URL || "https://app.elite.ekartlogistics.in").replace(/\/$/, "");
  const url = `${base}/integrations/v2/auth/token/${encodeURIComponent(process.env.EKART_CLIENT_ID)}`;
  try {
    const r = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ username: process.env.EKART_USERNAME, password: process.env.EKART_PASSWORD }),
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    if (!d.access_token) return null;
    const ttlMs = (Number(d.expires_in) || 86400) * 1000;
    _ekartToken = { token: d.access_token, exp: now + Math.max(60000, ttlMs - 3600000) };
    return d.access_token;
  } catch { return null; }
}
// Book a FORWARD Ekart shipment (seller -> customer) for a paid/placed order and
// return the Ekart tracking id. The pickup/return address is the one already
// registered on the seller's Ekart account (referenced by its alias).
export async function createEkartShipment(order, items) {
  if (!ekartAuthReady()) return { ok: false, err: "Ekart is not configured for booking (missing login)." };
  const token = await getEkartToken();
  if (!token) return { ok: false, err: "Could not authenticate with Ekart." };
  const base = (process.env.EKART_BASE_URL || "https://app.elite.ekartlogistics.in").replace(/\/$/, "");

  const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const isCod = String(order.payment_method || "").toLowerCase() === "cod";
  const total = num(order.total);
  const tax = num(order.tax_total);
  let taxable = num(order.subtotal != null ? order.subtotal : total - tax);
  if (!(taxable > 0)) taxable = total;
  const list = Array.isArray(items) ? items : [];
  const qty = list.reduce((s, it) => s + (Number(it.qty) || 1), 0) || 1;
  const desc = (list.map((it) => `${it.name}${it.variant ? ` (${it.variant})` : ""} x${it.qty || 1}`).join(", ") || "Suddhalaya order").slice(0, 250);
  const alias = process.env.EKART_PICKUP_ALIAS || "";
  const pin = parseInt(String(order.ship_pin || "").replace(/\D/g, ""), 10) || 0;
  const phone = parseInt(String(order.phone || "").replace(/\D/g, "").slice(-10), 10) || 0;
  const invDate = String(order.created_at || new Date().toISOString()).slice(0, 10);

  const payload = {
    seller_name: process.env.EKART_SELLER_NAME || "Suddhalaya Organic Pvt Ltd",
    seller_address: process.env.EKART_SELLER_ADDRESS || alias,
    seller_gst_tin: process.env.EKART_SELLER_GST || "",
    consignee_gst_amount: 0,
    order_number: String(order.order_no || "").replace(/^#/, ""),
    invoice_number: String(order.payment_invoice || order.order_no || "").replace(/^#/, ""),
    invoice_date: invDate,
    consignee_name: order.ship_name || order.customer_name || "Customer",
    // We collect a single customer phone (goes in drop_location.phone). Ekart rejects
    // an alternate that equals the main phone, so leave the alternate blank.
    consignee_alternate_phone: "",
    payment_mode: isCod ? "COD" : "Prepaid",
    category_of_goods: "Food & Wellness",
    products_desc: desc,
    total_amount: total,
    tax_value: tax,
    taxable_amount: taxable,
    commodity_value: String(taxable),
    cod_amount: isCod ? total : 0,
    quantity: qty,
    weight: Math.max(500, parseInt(process.env.EKART_DEFAULT_WEIGHT_G, 10) || 1000),
    length: parseInt(process.env.EKART_DEFAULT_L, 10) || 20,
    height: parseInt(process.env.EKART_DEFAULT_H, 10) || 12,
    width: parseInt(process.env.EKART_DEFAULT_W, 10) || 15,
    return_reason: "",
    drop_location: {
      address: [order.ship_line, order.ship_city, order.ship_state].filter(Boolean).join(", "),
      city: order.ship_city || "", state: order.ship_state || "", country: "India",
      name: order.ship_name || order.customer_name || "Customer",
      phone, pin,
    },
    // One address registered on the account → reference it by alias (Ekart autofills).
    pickup_location: { name: alias },
    return_location: { name: alias },
  };

  try {
    const r = await fetch(`${base}/api/v1/package/create`, {
      method: "PUT", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.status === false || !d.tracking_id) {
      return { ok: false, err: d.description || d.remark || d.message || `Ekart booking failed (${r.status})` };
    }
    return { ok: true, tracking_id: d.tracking_id, vendor: d.vendor, remark: d.remark, trackingUrl: ekartTrackingUrl(d.tracking_id) };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
}

export function ekartTrackingUrl(trackingId) {
  const base = process.env.EKART_PUBLIC_TRACK_URL || DEFAULT_PUBLIC;
  return base.replace(/\/?$/, "/") + encodeURIComponent(trackingId || "");
}

// Normalize Ekart's /api/v1/track/{id} response into a stable shape the UI can render.
// Shape: { _id, order_number, edd, track: { status, ctime, desc, location, details:[
//   { status, ctime, desc, location } ] } }.  Times are ms since epoch.
function normalizeEkart(data) {
  if (!data || typeof data !== "object") return { status: null, checkpoints: [] };
  const fmt = (v) => {
    if (v == null || v === "") return "";
    const n = Number(v);
    if (Number.isFinite(n) && n > 1e11) { try { return new Date(n).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }); } catch { return ""; } }
    return String(v);
  };
  const t = data.track && typeof data.track === "object" ? data.track : data;
  const status = t.status || data.status || data.current_status || null;
  let raw = t.details || data.checkpoints || data.scans || data.tracking_events || data.events || [];
  if (!Array.isArray(raw)) raw = [];
  let checkpoints = raw.map((c) => ({
    time: fmt(c.ctime ?? c.time ?? c.timestamp ?? c.event_date ?? c.scan_time ?? c.updated_at),
    status: c.status || c.state || c.activity || c.desc || c.description || c.remark || "",
    location: c.location || c.city || c.hub || c.branch || "",
  })).filter((c) => c.status || c.time);
  // No detail history but a top-level track scan → surface it as one checkpoint.
  if (!checkpoints.length && (t.status || t.desc)) {
    checkpoints = [{ time: fmt(t.ctime), status: t.status || "", location: t.location || "" }];
  }
  return { status, checkpoints };
}

export async function trackShipment(trackingId) {
  const id = (trackingId || "").trim();
  if (!id) return { ok: false, err: "No tracking number on this order yet." };
  const trackingUrl = ekartTrackingUrl(id);

  // Live API not fully configured → return the public tracking link only.
  if (!ekartApiReady()) {
    return { ok: true, apiConfigured: false, trackingId: id, trackingUrl, status: null, checkpoints: [] };
  }

  try {
    const url = process.env.EKART_BASE_URL.replace(/\/$/, "") + process.env.EKART_TRACK_PATH.replace("{id}", encodeURIComponent(id));
    const headers = { Accept: "application/json", "X-Client-ID": process.env.EKART_CLIENT_ID };
    if (process.env.EKART_API_SECRET) headers.Authorization = `Bearer ${process.env.EKART_API_SECRET}`;
    const r = await fetch(url, { headers, cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = r.status === 404
        ? "Tracking isn't available yet — it appears once the courier picks up your shipment."
        : (data && data.description) || `Ekart tracking is temporarily unavailable (${r.status}).`;
      return { ok: false, apiConfigured: true, err: msg, trackingId: id, trackingUrl };
    }
    return { ok: true, apiConfigured: true, trackingId: id, trackingUrl, ...normalizeEkart(data) };
  } catch (e) {
    return { ok: false, apiConfigured: true, err: String(e?.message || e), trackingId: id, trackingUrl };
  }
}
