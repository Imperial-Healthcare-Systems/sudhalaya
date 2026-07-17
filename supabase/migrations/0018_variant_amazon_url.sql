-- Suddhalaya backend — per-variation Buy-on-Amazon link.
--
-- WHY: amazon_url only existed on products, but on Amazon each size is normally its own
-- listing/ASIN — a single link can't serve 250 ml, 500 ml and 1 L. Each variant can now
-- carry its own link; the product-level amazon_url stays as a fallback for variants that
-- don't have one, so existing data keeps working unchanged.
-- Additive + idempotent + forward-only.

alter table public.product_variants
  add column if not exists amazon_url text not null default '';

comment on column public.product_variants.amazon_url is
  'Buy-on-Amazon link for this specific variation (ASIN). Falls back to products.amazon_url when blank.';
