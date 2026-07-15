-- Suddhalaya backend — Phase 4.4: product image storage.
-- Public bucket for product photos. Objects are readable via their public URL
-- (public bucket); uploads/deletes go through the service-role /api/admin/upload
-- route (which bypasses RLS after a staff check), so no extra object policies are
-- required. Idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/png','image/jpeg','image/jpg','image/webp','image/svg+xml'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Optional: let authenticated staff read the bucket listing (public read already works
-- for the object URLs). Insert/update/delete happen via service role in the API route.
do $$ begin
  create policy product_images_public_read on storage.objects
    for select using (bucket_id = 'product-images');
exception when duplicate_object then null; end $$;
