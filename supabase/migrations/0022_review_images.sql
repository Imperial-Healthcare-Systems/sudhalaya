-- Suddhalaya — customer review image uploads (client feedback 16 Aug).
-- Lets shoppers attach a photo to their product/home review; the URL points to the
-- public product-images bucket (reviews/ folder). Additive + idempotent + forward-only.

alter table public.product_reviews add column if not exists image_url text;
alter table public.home_reviews    add column if not exists image_url text;
