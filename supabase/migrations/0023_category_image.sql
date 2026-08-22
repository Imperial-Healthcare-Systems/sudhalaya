-- Category banner/tile image (shown on the storefront Shop-by-Category tiles).
-- Additive & idempotent — safe to re-run.
alter table public.categories add column if not exists image_url text;
