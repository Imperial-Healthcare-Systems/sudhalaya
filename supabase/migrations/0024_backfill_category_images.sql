-- Link the built-in storefront category photos into categories.image_url so the
-- existing images are explicit, admin-managed values (editable / replaceable in the
-- Categories editor). Only fills categories that don't already have an image, so it's
-- safe to re-run and never clobbers an uploaded image.
--
-- URLs mirror REAL_IMAGES['CAT#<name>'] in public/sudhalaya.js.
update public.categories set image_url =
  'https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/f3af05a465c5958e.jpg'
  where image_url is null and name = 'A2 Dairy';

update public.categories set image_url =
  'https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/9692803395cf4607.jpg'
  where image_url is null and name = 'Cold-Pressed Oils';

update public.categories set image_url =
  'https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/e0d7585245e3da29.jpg'
  where image_url is null and name = 'Spices';

update public.categories set image_url =
  'https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/c10f72364305abdf.jpg'
  where image_url is null and name = 'Honey';

update public.categories set image_url =
  'https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/b4a8d5420858ab3f.jpg'
  where image_url is null and name in ('Staples', 'Staples & Spices');
