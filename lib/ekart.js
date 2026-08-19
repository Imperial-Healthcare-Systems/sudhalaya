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

const DEFAULT_PUBLIC = "https://ekartlogistics.com/track/";

export function ekartConfigured() {
  return !!process.env.EKART_CLIENT_ID;
}
export function ekartApiReady() {
  return !!(process.env.EKART_CLIENT_ID && process.env.EKART_BASE_URL && process.env.EKART_TRACK_PATH);
}
export function ekartTrackingUrl(trackingId) {
  const base = process.env.EKART_PUBLIC_TRACK_URL || DEFAULT_PUBLIC;
  return base.replace(/\/?$/, "/") + encodeURIComponent(trackingId || "");
}

// Normalize whatever Ekart returns into a stable shape the UI can render.
function normalizeEkart(data) {
  if (!data || typeof data !== "object") return { status: null, checkpoints: [] };
  const status = data.status || data.current_status || data.shipmentStatus || data.state || (data.shipment && data.shipment.status) || null;
  const raw = data.checkpoints || data.scans || data.tracking_events || data.events || (data.shipment && data.shipment.scans) || [];
  const checkpoints = (Array.isArray(raw) ? raw : []).map((c) => ({
    time: c.time || c.timestamp || c.date || c.scan_time || c.updated_at || "",
    status: c.status || c.state || c.activity || c.description || c.remark || "",
    location: c.location || c.city || c.hub || c.branch || "",
  })).filter((c) => c.status || c.time);
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
    if (!r.ok) return { ok: false, apiConfigured: true, err: `Ekart API responded ${r.status}`, trackingId: id, trackingUrl };
    const data = await r.json().catch(() => ({}));
    return { ok: true, apiConfigured: true, trackingId: id, trackingUrl, ...normalizeEkart(data) };
  } catch (e) {
    return { ok: false, apiConfigured: true, err: String(e?.message || e), trackingId: id, trackingUrl };
  }
}
