-- Suddhalaya backend — per-product low-stock alert threshold.
--
-- WHY: "low stock" was hardcoded to <= 10 for every product, which is meaningless when a
-- ₹79 atta pouch and a ₹1699 ghee tin have very different reorder points. Admins can now
-- set the alert level per product. Default 10 preserves the existing behaviour exactly.
-- Additive + idempotent + forward-only.

alter table public.products
  add column if not exists low_stock_threshold int not null default 10;

do $$ begin
  alter table public.products add constraint products_low_stock_chk
    check (low_stock_threshold >= 0);
exception when duplicate_object then null; end $$;

comment on column public.products.low_stock_threshold is
  'Units at or below which this product counts as Low Stock (0 = never warn). Default 10.';
