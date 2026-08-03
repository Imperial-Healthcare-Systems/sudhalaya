// Branded, self-contained HTML email templates (all styles inline for mail clients).

const FOREST = "#1f3520";
const GOLD = "#b08d3c";
const CREAM = "#faf6ee";
const INK = "#2c2c28";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function money(n) {
  const v = Number(n) || 0;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shell(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM};font-family:Segoe UI,Helvetica,Arial,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #eadfce;border-radius:14px;overflow:hidden">
        <tr><td style="background:${FOREST};padding:22px 28px;text-align:center">
          <div style="font-size:20px;font-weight:700;letter-spacing:.5px;color:${CREAM}">Suddhalaya</div>
          <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${GOLD};margin-top:4px">House of Purity</div>
        </td></tr>
        <tr><td style="padding:28px">${bodyHtml}</td></tr>
        <tr><td style="background:#f4ecdd;padding:18px 28px;text-align:center;font-size:12px;color:#7a7568">
          Suddhalaya Organic Pvt Ltd · <a href="mailto:support@suddhalaya.com" style="color:${GOLD}">support@suddhalaya.com</a><br>
          You received this email because you have an account or placed an order with us.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

export function welcomeEmail({ name }) {
  const first = (name || "there").split(" ")[0];
  const html = shell("Welcome to Suddhalaya", `
    <h1 style="font-size:22px;color:${FOREST};margin:0 0 12px">Welcome, ${esc(first)} 🌿</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px">Thank you for creating an account with <b>Suddhalaya</b> — your home for pure, traceable, lab-tested organic essentials.</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px">Every batch of our A2 ghee, cold-pressed oils and raw honey is sourced directly from named producers and third-party tested for purity. We're glad to have you with us.</p>
    <p style="text-align:center;margin:26px 0">
      <a href="https://www.suddhalaya.com/#shop" style="background:${FOREST};color:${CREAM};text-decoration:none;padding:12px 26px;border-radius:40px;font-size:14px;display:inline-block">Explore the collection →</a>
    </p>
    <p style="font-size:13px;color:#7a7568;margin:0">Warmly,<br>The Suddhalaya team</p>`);
  const text = `Welcome, ${first}!\n\nThank you for creating an account with Suddhalaya — your home for pure, traceable, lab-tested organic essentials.\n\nExplore the collection: https://www.suddhalaya.com/#shop\n\n— The Suddhalaya team`;
  return { subject: "Welcome to Suddhalaya 🌿", html, text };
}

export function orderConfirmationEmail({ name, orderNo, total, paymentStatus, paymentMethod, ship, items }) {
  const first = (name || "there").split(" ")[0];
  const paid = paymentStatus === "paid";
  const addr = ship
    ? [ship.name, ship.line, [ship.city, ship.state, ship.pin].filter(Boolean).join(", ")].filter(Boolean).map(esc).join("<br>")
    : "";
  const lines = Array.isArray(items) && items.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;font-size:14px">
        ${items.map((it) => `<tr>
          <td style="padding:6px 0;border-bottom:1px solid #f0e8d8">${esc(it.name || it.sku)}${it.variant ? ` <span style="color:#8a8578">· ${esc(it.variant)}</span>` : ""}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f0e8d8;text-align:right;white-space:nowrap">× ${esc(it.qty || 1)}</td>
        </tr>`).join("")}
      </table>`
    : "";
  const html = shell("Order confirmed", `
    <h1 style="font-size:22px;color:${FOREST};margin:0 0 6px">Order confirmed ✓</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Thanks, ${esc(first)} — we've received your order <b>${esc(orderNo)}</b>${paid ? " and your payment." : ". Your order will be collected on delivery (COD)."}</p>
    ${lines}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;margin:0 0 16px">
      <tr><td style="padding:4px 0;color:#7a7568">Order total</td><td style="padding:4px 0;text-align:right;font-weight:700;color:${FOREST}">${money(total)}</td></tr>
      <tr><td style="padding:4px 0;color:#7a7568">Payment</td><td style="padding:4px 0;text-align:right">${esc((paymentMethod || "").toUpperCase())} · ${paid ? "Paid" : "Pending (COD)"}</td></tr>
    </table>
    ${addr ? `<p style="font-size:13px;color:#7a7568;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">Delivering to</p><p style="font-size:14px;line-height:1.5;margin:0 0 18px">${addr}</p>` : ""}
    <p style="font-size:14px;line-height:1.6;margin:0 0 6px">We'll email you again when your order ships. Questions? Just reply to this email or write to <a href="mailto:support@suddhalaya.com" style="color:${GOLD}">support@suddhalaya.com</a>.</p>
    <p style="font-size:13px;color:#7a7568;margin:18px 0 0">With gratitude,<br>The Suddhalaya team</p>`);
  const text = `Order confirmed — ${orderNo}\n\nThanks, ${first}! We've received your order.\nOrder total: ${money(total)}\nPayment: ${(paymentMethod || "").toUpperCase()} · ${paid ? "Paid" : "Pending (COD)"}\n\nWe'll email you when it ships. — The Suddhalaya team`;
  return { subject: `Your Suddhalaya order ${orderNo} is confirmed`, html, text };
}
