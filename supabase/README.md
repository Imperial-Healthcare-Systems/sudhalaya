# Suddhalaya — Backend (Supabase)

Phase 1 of the backend: **schema + auth + catalog/orders**, wired into the existing
storefront by swapping its data layer. The site still runs with **no backend**
(falls back to in-code seeds + `localStorage`), so nothing breaks before setup.

## What's here

```
supabase/
  migrations/
    0001_schema.sql      tables, indexes, updated_at triggers, sequences
    0002_rls.sql         Row-Level Security + is_staff()/has_perm() helpers
    0003_functions.sql   place_order() + validate_coupon() (SECURITY DEFINER)
  seed-data.mjs          canonical catalog data (extracted from the engine)
  seed.mjs               idempotent seeder (products, config, customers, sample orders)
lib/supabase/            server + admin Supabase clients
lib/shape.js             DB row -> engine object mappers
app/api/                 bootstrap, auth/{signup,login,logout,me}, orders, coupon
```

## One-time setup

1. **Create a Supabase project** (https://supabase.com). In *Authentication → Providers → Email*,
   turn **off** "Confirm email" (or keep it on — the seeder/signup use admin create with
   `email_confirm: true`, so shoppers are usable immediately either way).

2. **Env** — copy `.env.example` to `.env.local` and fill in from *Settings → API*:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   # optional owner login for the admin console (phase 2):
   SEED_ADMIN_EMAIL=owner@suddhalaya.com
   SEED_ADMIN_PASSWORD=change-me-strong
   ```

3. **Apply migrations** — either paste each file in the Supabase SQL editor in order,
   or with the Supabase CLI:
   ```bash
   supabase link --project-ref <ref>
   supabase db push          # or run the three files under migrations/ in order
   ```

4. **Seed** the catalog, config, customers and sample orders:
   ```bash
   npm run seed
   ```

5. **Run** — `npm run dev`. On boot the storefront calls `/api/bootstrap`; once it
   reports `configured:true`, catalog/auth/orders come from Postgres. You'll see real
   rows in the Supabase Table editor after placing an order.

## How the swap works

- The engine probes `GET /api/bootstrap` on boot. If configured, it replaces its
  in-memory `PRODUCTS/CATEGORIES/SETTINGS/CMS/HOME_REVIEWS` with DB data and caches the
  signed-in shopper; otherwise it keeps the local seeds. A global `BACKEND` flag gates
  every data path.
- **Auth** (`/api/auth/*`) uses Supabase Auth with httpOnly cookie sessions. Sign up
  with name + email + **mobile**; sign in with **email or mobile** (client #11).
- **Orders** are placed via `place_order()` — a `SECURITY DEFINER` function that
  re-validates price and stock, computes GST-inclusive totals + shipping + coupon,
  writes order/items/timeline, deducts stock, and upserts the customer. Prices are
  **never** trusted from the client.
- **Coupons** validate through `validate_coupon()`; codes are never listed publicly.
- **RLS**: anon can read only the published catalog, active categories, storefront
  config and approved reviews. Shoppers read their own profile/orders. Staff
  (rows in `public.staff`) manage operational data.

## Phase 2 — admin auth + write-through (done)

- **Admin login via Supabase Auth + roles.** Staff sign in at `#/admin` with their
  email + password; access requires an active row in `public.staff`. Sessions persist
  across refresh. (Offline demo still uses the username/OTP flow.)
  - Create staff: set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` before `npm run seed`
    (creates an `owner`), or insert rows into `public.staff` (roles: owner, manager,
    fulfilment, support, finance, readonly).
- **Write-through** — admin edits persist to Postgres via `POST /api/admin/op`, a single
  staff-guarded dispatcher where **RLS enforces per-role permissions** on every write:
  products (create/edit/clone/archive/variants/stock), categories, coupons
  (create/toggle/delete), order status transitions (+ timeline, tracking, restock on
  cancel), and settings/CMS. Offline, the same actions fall back to localStorage.
- **Admin reads** — on login the console loads real orders, customers, coupons and
  returns from the DB via `GET /api/admin/data` (staff-only).

## Phase 3 — persistence completion (done)

- **Reviews** persist to the DB. Storefront product & homepage review submissions go to
  `POST /api/reviews` (anon insert via RLS); approved reviews load back through
  `/api/bootstrap` and show on the PDP / homepage.
- **On-site analytics** persist: `track()` posts page/product/cart/order events to
  `POST /api/track`, which calls the `track_event()` SECURITY DEFINER function to
  increment `analytics_daily`. The admin Reports traffic panel reads real counts via
  `/api/admin/data`.
- **Returns/RMA** write through the op dispatcher: create, approve/reject, and refund
  (refund also flips the order to `refunded` and restocks via `order.status`).
- **Payment capture** persists (`payment.capture` op) — marks paid, records the txn/
  gateway/invoice and appends the timeline event.

Migration `0005_analytics.sql` adds `track_event()`.

## Not yet (next up)

- **Real Razorpay capture** — needs a Razorpay account + keys. Order currently records a
  simulated capture; wiring the checkout widget + create-order + signature verify is a
  focused next pass.
- **Staff provisioning UI** — creating/editing staff needs auth-user invites (admin API);
  staff auth + role-gating already work.
- **Product image uploads to Supabase Storage** (schema has `image_urls`; images are
  base64/client-side today).

---

## Phase 4 — Warehouse/Batches, Targeted Coupons, Region Report (migrations 0007–0013)

Apply **in order** after 0001–0006:

```
0007_warehouse_batches.sql   warehouses, inventory_batches, stock_movements, mirror trigger
0008_warehouse_rls.sql       RLS + 'warehouse' permission (redefines has_perm)
0009_stock_functions.sql     receive_stock, adjust_batch, transfer_stock, deduct_fifo, restock_batch
0010_place_order_fifo.sql    default warehouse + BACKFILL existing stock into INIT batches; place_order -> FIFO
0011_targeted_coupons.sql    coupon scope columns + coupon_redemptions ledger
0012_coupon_logic.sql        scope-aware validate_coupon (4-arg) + place_order (redemptions)
0013_regional_report.sql     sales_by_region(from,to,group) reporting function
```

### 4.1 Batch / manufacture-date inventory (FIFO)
- **Batches hold the stock.** Each `product_variants` row has many `inventory_batches`
  (batch_no, mfg_date, expiry_date, qty_received, qty_remaining, warehouse, cost).
  `product_variants.stock` is a **cached mirror** = SUM(batch qty_remaining), kept current
  by an AFTER trigger on `inventory_batches` (**non-recursive**: it only writes
  `product_variants`, which has no back-trigger). All existing `variant.stock` reads keep working.
- **0010 backfills** existing variant stock into an `INIT` batch (in a default "Main
  Warehouse") so orders keep working the instant FIFO takes over. Idempotent.
- **FIFO fulfilment:** `place_order` calls `deduct_fifo(variant, qty, ...)`, which draws down
  batches **oldest `mfg_date` first**, spanning batches, and RAISEs "Insufficient stock" if
  short. Every movement is logged in `stock_movements` (receive/order/return_restock/
  adjustment/transfer_out/transfer_in/damage).
- **Return-restock choice:** refunds/cancels route through `restock_batch`, which returns
  units to the variant's **most-recent batch** (or creates a `RETURNS` lot in the default
  warehouse if none), logged `reason='return_restock'`.
- **Admin ops** (via `/api/admin/op`, staff-session/RLS): `warehouse.upsert/delete`,
  `batch.receive/adjust/transfer`. Batches for a variant load from `GET /api/admin/inventory`.
  UI: Inventory tab → **Warehouses** sub-view + per-row **📦 Batches** modal (receive/adjust/
  transfer, expiry highlighting). Offline fallback models batches as arrays on the variant with
  a JS FIFO deduct in `placeOrder`.
- **Security:** staff-facing stock functions enforce `has_perm('warehouse' | 'inventory')`
  internally; `deduct_fifo` is ungranted (only `place_order` calls it).

### 4.2 Targeted coupons
- `coupons` gains `scope` ('all' | 'products' | 'users' | 'user_products'), `product_skus`
  (variant SKUs), `user_emails`, `per_user_limit`. `coupon_redemptions` logs each use.
- **Semantics:** product-scoped coupons discount **only the eligible SKUs' subtotal**;
  user-scoped coupons are rejected for emails not in `user_emails`; `per_user_limit` is
  enforced by counting redemptions; min-cart/expiry/cap still apply. `validate_coupon` gained a
  4-arg form (user email + cart line skus/amounts); the 2-arg form remains as a wrapper.
  `place_order` writes a `coupon_redemptions` row on success.
- **Routes:** `POST /api/coupon` passes the session email + cart items; it **falls back to the
  legacy 2-arg validator** if 0012 isn't applied yet (no regression window). Admin Coupons tab
  has a scope selector, product multi-select, allowed-emails list, per-user limit, and scope
  badges. Offline fallback mirrors the scope logic in `applyCoupon()`/`couponDiscount()`.

### 4.3 Region-wise sales report
- `sales_by_region(p_from, p_to, p_group)` (`p_group` in 'state'|'city', `has_perm('reports')`)
  returns per-region order_count, units, gross_revenue (paid orders), avg_order_value, and
  coupon-discount total. State/city names are normalised (trim+upper) so variants group together.
- **Route:** `GET /api/admin/report/region?from&to&group`. Reports tab gains a **Region-wise
  sales** section: state/city toggle, date range, sortable breakdown table, revenue bars, and CSV
  export. Offline fallback aggregates in-memory `ORDERS` by `ship.state`/`ship.city`.

**Apply note:** run 0007–0013 in the Supabase SQL editor in order. The app degrades gracefully
before they're applied (existing flows unaffected; new panels show empty/"no data").

### 4.4 Product image upload (Supabase Storage) — migration 0014
- `0014_product_images_storage.sql` creates a **public `product-images` bucket**. (Already
  created live via the Storage API; the migration makes fresh setups reproducible.)
- `POST /api/admin/upload` (staff-guarded) takes a base64 data URL, uploads via the service
  role, and returns a public URL. The **product Edit modal** has a *Product images* section:
  add photos (first = main), remove, reorder-by-removal; saved into `products.image_urls`.
- Storefront `primaryImg()` / `galleryFor()` prefer `imageUrls`, falling back to the built-in
  base64 photo / generated SVG per SKU. Offline fallback stores the image as an inline data URL.
- Verified live: upload → public URL (200) → `product.upsert` persists `image_urls` (other
  product fields untouched) → `/api/bootstrap` returns it to the storefront.
