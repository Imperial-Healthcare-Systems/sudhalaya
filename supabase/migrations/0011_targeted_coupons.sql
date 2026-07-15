-- Suddhalaya backend — Phase 4.2: user- and product-specific coupons.
-- Additive columns on coupons (defaults preserve current 'all' behavior) +
-- a coupon_redemptions ledger. Idempotent + forward-only.

alter table public.coupons add column if not exists scope          text   not null default 'all';
alter table public.coupons add column if not exists product_skus   jsonb  not null default '[]'::jsonb;
alter table public.coupons add column if not exists user_emails    jsonb  not null default '[]'::jsonb;
alter table public.coupons add column if not exists per_user_limit int    not null default 0;

-- scope check (guarded so re-running doesn't error)
do $$ begin
  alter table public.coupons add constraint coupons_scope_chk
    check (scope in ('all','products','users','user_products'));
exception when duplicate_object then null; end $$;

create table if not exists public.coupon_redemptions (
  id         bigint generated always as identity primary key,
  code       text references public.coupons(code) on delete cascade,
  user_email text,
  order_no   text,
  discount   numeric(10,2),
  created_at timestamptz not null default now()
);
create index if not exists coupon_redemptions_code_email_idx on public.coupon_redemptions (code, user_email);

alter table public.coupon_redemptions enable row level security;
-- staff can read; inserts happen inside place_order (SECURITY DEFINER), not from clients
drop policy if exists redemptions_staff_read on public.coupon_redemptions;
create policy redemptions_staff_read on public.coupon_redemptions for select using (public.has_perm('coupons') or public.has_perm('reports'));
