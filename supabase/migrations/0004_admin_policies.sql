-- Suddhalaya backend — Phase 2 admin write policies.
-- Lets staff mutate order timelines/items when advancing orders from the console.
-- (place_order runs SECURITY DEFINER so it already bypasses these for shoppers.)

create policy order_events_staff_write on public.order_events for all
  using (public.has_perm('orders')) with check (public.has_perm('orders'));

create policy order_items_staff_write on public.order_items for all
  using (public.has_perm('orders')) with check (public.has_perm('orders'));

-- allow staff to read the customers/coupons they manage is already covered by
-- customers_staff_all / coupons_staff_all. Nothing else needed here.
