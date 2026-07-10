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
