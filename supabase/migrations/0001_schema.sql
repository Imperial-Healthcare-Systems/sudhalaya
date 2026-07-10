-- Suddhalaya backend — schema (Phase 1)
-- Postgres / Supabase. Run in order: 0001_schema, 0002_rls, 0003_functions, then seed.
-- Mirrors the data model the storefront engine uses (products+variants, orders+items+events,
-- customers, coupons, categories, returns, reviews, audit, analytics, settings/cms).

create extension if not exists pgcrypto;

-- updated_at helper
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- Identity: shopper profiles (1:1 with auth.users) + admin staff/roles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_phone_key on public.profiles(phone) where phone is not null;
create trigger profiles_set_updated before update on public.profiles
  for each row execute function public.set_updated_at();

do $$ begin
  create type public.staff_role as enum ('owner','manager','fulfilment','support','finance','readonly');
exception when duplicate_object then null; end $$;

create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text,
  email      text,
  role       public.staff_role not null default 'readonly',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id         bigint generated always as identity primary key,
  name       text not null,
  slug       text not null unique,
  seo        text,
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger categories_set_updated before update on public.categories
  for each row execute function public.set_updated_at();

create table if not exists public.products (
  id          bigint generated always as identity primary key,
  sku         text not null unique,
  name        text not null,
  category    text not null,
  rating      numeric(2,1) default 0,
  review_count int default 0,
  tag         text default '',
  type        text default 'jar',
  color1      text,
  color2      text,
  gst         numeric(5,2) not null default 0,
  hsn         text,
  ship_fee    numeric(10,2) not null default 0,   -- client #3 per-product shipping surcharge
  amazon_url  text default '',                     -- client #12
  description text default '',
  seo_title   text,
  feats       jsonb not null default '[]'::jsonb,
  content     jsonb not null default '{}'::jsonb,  -- {origin,ingredients,usage,certifications,labUrl,shelfLife,netWeight}
  faqs        jsonb not null default '[]'::jsonb,  -- client #9
  image_urls  jsonb not null default '[]'::jsonb,  -- future: Supabase Storage URLs
  draft       boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger products_set_updated before update on public.products
  for each row execute function public.set_updated_at();

create table if not exists public.product_variants (
  id         bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  label      text not null,
  sku        text not null unique,
  price      numeric(10,2) not null,
  mrp        numeric(10,2) not null,
  stock      int not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists product_variants_product_idx on public.product_variants(product_id);

-- ---------------------------------------------------------------------------
-- Commerce: coupons, customers, orders
-- ---------------------------------------------------------------------------
create table if not exists public.coupons (
  code        text primary key,
  type        text not null check (type in ('pct','flat')),
  value       numeric(10,2) not null,
  description text,
  active      boolean not null default true,
  uses        int not null default 0,
  cap         int not null default 0,          -- 0 = unlimited
  min_cart    numeric(10,2) not null default 0,
  expires     date,
  created_at  timestamptz not null default now()
);

create table if not exists public.customers (
  id         bigint generated always as identity primary key,
  name       text,
  email      text unique,
  phone      text,
  city       text,
  since      text,
  tags       jsonb not null default '[]'::jsonb,
  user_id    uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  order_no           text not null unique,
  user_id            uuid references auth.users(id) on delete set null,
  customer_id        bigint references public.customers(id) on delete set null,
  customer_name      text,
  email              text,
  phone              text,
  ship_name          text, ship_line text, ship_city text, ship_state text, ship_pin text,
  payment_method     text,
  payment_status     text default 'pending',
  payment_txn_id     text default '',
  payment_gateway    text default '',
  payment_captured_at text default '',
  payment_invoice    text,
  coupon_code        text,
  subtotal           numeric(10,2) not null default 0,   -- ex-GST base
  tax_total          numeric(10,2) not null default 0,
  ship_total         numeric(10,2) not null default 0,
  total              numeric(10,2) not null default 0,
  status             text not null default 'processing',
  tracking           jsonb,
  placed_at          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists orders_user_idx  on public.orders(user_id);
create index if not exists orders_email_idx on public.orders(email);
create trigger orders_set_updated before update on public.orders
  for each row execute function public.set_updated_at();

create table if not exists public.order_items (
  id       bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  sku      text, name text, variant text,
  qty      int not null,
  price    numeric(10,2) not null,
  gst      numeric(5,2) not null default 0
);
create index if not exists order_items_order_idx on public.order_items(order_id);

create table if not exists public.order_events (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders(id) on delete cascade,
  at         text,
  actor      text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events(order_id);

-- ---------------------------------------------------------------------------
-- Support: returns, reviews, audit, analytics, config
-- ---------------------------------------------------------------------------
create table if not exists public.returns (
  id         text primary key,     -- RMA-xxxx
  order_no   text,
  customer   text,
  sku        text,
  reason     text,
  status     text default 'requested',
  refund     numeric(10,2) default 0,
  date       text,
  restock    boolean default false,
  created_at timestamptz not null default now()
);

create table if not exists public.product_reviews (
  id          bigint generated always as identity primary key,
  product_sku text,
  name        text,
  rating      int check (rating between 1 and 5),
  body        text,
  verified    boolean not null default false,
  approved    boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.home_reviews (
  id         bigint generated always as identity primary key,
  body       text,
  name       text,
  location   text,
  rating     int check (rating between 1 and 5),
  verified   boolean not null default false,
  approved   boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         text,
  actor      text,
  action     text,
  entity     text,
  detail     text,
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_daily (
  day           date primary key,
  views         int not null default 0,
  product_views int not null default 0,
  add_to_cart   int not null default 0,
  orders        int not null default 0
);

-- settings + cms live as jsonb rows so the engine's SETTINGS / CMS objects map 1:1
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create trigger app_config_set_updated before update on public.app_config
  for each row execute function public.set_updated_at();

-- order numbering + GST invoice numbering (match engine: #SDL2042.., INV-2026-0043..)
create sequence if not exists public.order_no_seq start 2042;
create sequence if not exists public.invoice_seq  start 43;
