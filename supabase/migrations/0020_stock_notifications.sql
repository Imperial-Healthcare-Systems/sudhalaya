-- Suddhalaya — "Notify me when back in stock" waitlist.
--
-- The storefront "Notify Me" button (shown on out-of-stock products) collects a
-- shopper's email. When the product is restocked (via receive_stock), the admin op
-- emails everyone waiting and marks them notified.
-- Additive + idempotent + forward-only.

create table if not exists public.stock_notifications (
  id          bigint generated always as identity primary key,
  product_sku text not null,
  email       text not null,
  notified    boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.stock_notifications enable row level security;

-- Anyone may request a notification; only staff can read / manage the waitlist.
drop policy if exists stock_notif_insert on public.stock_notifications;
create policy stock_notif_insert on public.stock_notifications for insert with check (true);
drop policy if exists stock_notif_staff on public.stock_notifications;
create policy stock_notif_staff on public.stock_notifications for all
  using (public.is_staff()) with check (public.is_staff());

-- One active request per (product, email); re-subscribing is a no-op.
create unique index if not exists stock_notif_unique
  on public.stock_notifications (product_sku, lower(email));

comment on table public.stock_notifications is
  'Back-in-stock waitlist. Insert on "Notify Me"; emailed + notified=true when the product is restocked.';
