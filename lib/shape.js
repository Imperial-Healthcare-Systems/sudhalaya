// Map DB rows back into the exact shapes the storefront engine expects,
// so the data-layer swap is transparent to the UI code.

export function productToEngine(p) {
  const variants = (p.product_variants || [])
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((v) => ({ label: v.label, sku: v.sku, price: Number(v.price), mrp: Number(v.mrp), stock: v.stock }));
  return {
    id: p.id,
    name: p.name,
    cat: p.category,
    rating: Number(p.rating) || 0,
    reviews: p.review_count || 0,
    sku: p.sku,
    tag: p.tag || "",
    type: p.type || "jar",
    c1: p.color1,
    c2: p.color2,
    gst: Number(p.gst) || 0,
    hsn: p.hsn || "",
    shipFee: Number(p.ship_fee) || 0,
    amazonUrl: p.amazon_url || "",
    desc: p.description || "",
    seoTitle: p.seo_title || p.name,
    feats: p.feats || [],
    content: p.content || {},
    faqs: p.faqs || [],
    draft: !!p.draft,
    variants,
  };
}

export function categoryToEngine(c) {
  return { id: c.id, name: c.name, slug: c.slug, seo: c.seo, order: c.sort_order };
}

// DB order (+ items + events) → the engine's order object shape.
export function orderToEngine(o) {
  return {
    id: o.order_no,
    dbId: o.id,
    customerId: o.customer_id,
    customer: o.customer_name,
    email: o.email,
    phone: o.phone,
    lines: (o.order_items || []).map((l) => ({
      sku: l.sku, name: l.name, variant: l.variant, qty: l.qty, price: Number(l.price), gst: Number(l.gst) || 0,
    })),
    ship: { name: o.ship_name, line: o.ship_line, city: o.ship_city, state: o.ship_state, pin: o.ship_pin },
    payment: {
      method: o.payment_method, status: o.payment_status, txnId: o.payment_txn_id || "",
      gateway: o.payment_gateway || "", capturedAt: o.payment_captured_at || "", invoice: o.payment_invoice || undefined,
    },
    shipTotal: Number(o.ship_total) || 0,
    subtotal: Number(o.subtotal) || 0,
    taxTotal: Number(o.tax_total) || 0,
    total: Number(o.total) || 0,
    status: o.status,
    date: (o.placed_at || "").slice(0, 10),
    tracking: o.tracking || undefined,
    timeline: (o.order_events || []).map((e) => ({ t: e.at, actor: e.actor, note: e.note })),
    items: (o.order_items || []).reduce((s, l) => s + l.qty, 0),
  };
}
