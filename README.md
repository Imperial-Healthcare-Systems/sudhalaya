# Suddhalaya — Next.js

A faithful **Next.js 15 (App Router)** port of the original single-file Suddhalaya
storefront (`suddhalaya_final (13).html`). Behaviour is preserved 1:1 — all state
(cart, wishlist, accounts, orders, admin data) still lives in the browser's
`localStorage`, exactly as before.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build && npm run start   # production
```

## How it maps to the original

| Original (single HTML file)        | Here                          |
| ---------------------------------- | ----------------------------- |
| `<head>` meta / OG / Twitter / JSON-LD | `app/layout.js` (Metadata API) |
| Google Fonts `<link>`              | `app/layout.js` `<head>`      |
| `<style>` block (~856 lines)       | `app/globals.css` (verbatim)  |
| Container divs + `#toast`          | `app/page.js`                 |
| `<script>` engine (~2480 lines, 197 fns) | `public/sudhalaya.js` (verbatim) |

### Why the engine is served from `/public`

The original renders everything imperatively (`renderSite`/`renderAdmin` write
into empty divs) and wires inline `onclick="fn()"` handlers to ~197 **global**
functions. Serving the engine verbatim as a classic (non-module) script via
`next/script` keeps every function on `window`, so the inline handlers resolve
and nothing transpiles/drifts. A full React rewrite would risk behavioural
changes; this keeps the port exact.

## Routes

- `/` — storefront (`#/`)
- Admin console at `#/admin` (login gate, then 16 admin tabs)

## Next steps (optional)

The `localStorage` data layer is the natural seam to later swap for a real
backend (e.g. Supabase) without touching the UI logic.
