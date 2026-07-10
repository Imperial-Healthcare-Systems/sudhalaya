-- Suddhalaya backend — Row-Level Security (Phase 1)
-- Model:
--   * Public (anon) can READ the published catalog, active categories, storefront config,
--     and approved reviews. Nothing else.
--   * Shoppers can read/update their own profile and read their own orders.
--   * Staff (rows in public.staff, active) can read/write operational data.
--   * Coupon validation and order placement go through SECURITY DEFINER functions
--     (0003), so coupon codes and price/stock logic are never trusted from the client.

-- helpers -------------------------------------------------------------------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.user_id = auth.uid() and s.active);
$$;

create or replace function public.has_perm(_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = auth.uid() and s.active
      and (s.role = 'owner' or _perm = any (
        case s.role
          when 'manager'    then array['orders','inventory','products','customers','returns','reports','coupons','categories','cms']
          when 'fulfilment' then array['orders','inventory','returns']
          when 'support'    then array['orders','customers','returns']
          when 'finance'    then array['orders','reports','payments']
          else array['view']
        end))
  );
$$;

-- enable RLS ----------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.staff            enable row level security;
alter table public.categories       enable row level security;
alter table public.products         enable row level security;
alter table public.product_variants enable row level security;
alter table public.coupons          enable row level security;
alter table public.customers        enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;
alter table public.order_events     enable row level security;
alter table public.returns          enable row level security;
alter table public.product_reviews  enable row level security;
alter table public.home_reviews     enable row level security;
alter table public.audit_log        enable row level security;
alter table public.analytics_daily  enable row level security;
alter table public.app_config       enable row level security;

-- profiles: self-service; staff can read all
create policy profiles_self_read   on public.profiles for select using (id = auth.uid() or public.is_staff());
create policy profiles_self_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- staff: each staff member reads ONLY their own row. This must NOT call a function
-- that queries `staff` (e.g. is_staff()), or Postgres raises "infinite recursion in
-- policy". Every server route only needs the caller's own row. Staff writes happen
-- through the service role (seeder / admin API), so there is no anon/authenticated
-- write policy here.
create policy staff_self_read on public.staff for select using (user_id = auth.uid());

-- categories: public reads active; staff manage
create policy categories_public_read on public.categories for select using (active or public.is_staff());
create policy categories_staff_all   on public.categories for all using (public.has_perm('categories')) with check (public.has_perm('categories'));

-- products: public reads published; staff manage
create policy products_public_read on public.products for select using (draft = false or public.is_staff());
create policy products_staff_all   on public.products for all using (public.has_perm('products')) with check (public.has_perm('products'));

-- variants: readable when the parent product is; staff manage
create policy variants_public_read on public.product_variants for select
  using (exists (select 1 from public.products p where p.id = product_id and (p.draft = false or public.is_staff())));
create policy variants_staff_all on public.product_variants for all
  using (public.has_perm('products')) with check (public.has_perm('products'));

-- coupons: never listed publicly (validated via SECURITY DEFINER). Staff manage.
create policy coupons_staff_all on public.coupons for all using (public.has_perm('coupons')) with check (public.has_perm('coupons'));

-- customers: staff only (order placement upserts via SECURITY DEFINER)
create policy customers_staff_all on public.customers for all using (public.has_perm('customers')) with check (public.has_perm('customers'));

-- orders: shopper reads own; staff read/write all (inserts happen via place_order definer)
create policy orders_own_read on public.orders for select using (user_id = auth.uid() or public.is_staff());
create policy orders_staff_write on public.orders for update using (public.has_perm('orders')) with check (public.has_perm('orders'));

create policy order_items_read on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_staff())));
create policy order_events_read on public.order_events for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_staff())));

-- returns / audit / analytics: staff only
create policy returns_staff_all   on public.returns        for all using (public.has_perm('returns')) with check (public.has_perm('returns'));
create policy audit_staff_read    on public.audit_log      for select using (public.is_staff());
create policy analytics_staff_read on public.analytics_daily for select using (public.has_perm('reports'));

-- reviews: public reads approved; anyone may submit (moderation flag), staff manage
create policy product_reviews_read   on public.product_reviews for select using (approved or public.is_staff());
create policy product_reviews_insert on public.product_reviews for insert with check (true);
create policy product_reviews_staff  on public.product_reviews for all using (public.is_staff()) with check (public.is_staff());
create policy home_reviews_read      on public.home_reviews for select using (approved or public.is_staff());
create policy home_reviews_insert    on public.home_reviews for insert with check (true);
create policy home_reviews_staff     on public.home_reviews for all using (public.is_staff()) with check (public.is_staff());

-- app_config: public reads storefront settings/cms; staff write
create policy app_config_public_read on public.app_config for select using (true);
create policy app_config_staff_write on public.app_config for all using (public.is_staff()) with check (public.is_staff());
