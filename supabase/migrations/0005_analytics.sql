-- Suddhalaya backend — Phase 3: on-site analytics ingestion.
-- Anonymous visitors increment daily counters through a SECURITY DEFINER function
-- (so the analytics_daily table itself stays staff-read-only via RLS).

create or replace function public.track_event(p_evt text)
returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  insert into public.analytics_daily(day, views, product_views, add_to_cart, orders)
    values (d,
      case when p_evt='view'    then 1 else 0 end,
      case when p_evt='product' then 1 else 0 end,
      case when p_evt='cart'    then 1 else 0 end,
      case when p_evt='order'   then 1 else 0 end)
  on conflict (day) do update set
    views         = public.analytics_daily.views         + (case when p_evt='view'    then 1 else 0 end),
    product_views = public.analytics_daily.product_views + (case when p_evt='product' then 1 else 0 end),
    add_to_cart   = public.analytics_daily.add_to_cart   + (case when p_evt='cart'    then 1 else 0 end),
    orders        = public.analytics_daily.orders        + (case when p_evt='order'   then 1 else 0 end);
end $$;

grant execute on function public.track_event(text) to anon, authenticated;
