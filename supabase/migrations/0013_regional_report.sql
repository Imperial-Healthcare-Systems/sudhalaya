-- Suddhalaya backend — Phase 4.3: region-wise sales report.
-- Aggregates PAID orders by shipping state or city over a date range. State/city
-- names are normalised (trim + upper) so "Karnataka" and "karnataka " group together.
-- SECURITY DEFINER + internal has_perm('reports') guard.

create or replace function public.sales_by_region(p_from date, p_to date, p_group text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Not authorized for reports.';
  end if;

  with paid as (
    select o.id, o.order_no, o.total,
           coalesce(nullif(upper(trim(
             case when p_group = 'city' then o.ship_city else o.ship_state end)), ''), '—') as reg
      from public.orders o
     where o.payment_status = 'paid'
       and (o.placed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ),
  u as (select order_id, sum(qty) as q from public.order_items group by order_id),
  d as (select order_no, sum(discount) as disc from public.coupon_redemptions group by order_no),
  agg as (
    select paid.reg as region,
           count(*)                              as orders,
           coalesce(sum(u.q), 0)                 as units,
           round(sum(paid.total), 2)             as revenue,
           round(avg(paid.total), 2)             as aov,
           round(coalesce(sum(d.disc), 0), 2)    as discount
      from paid
      left join u on u.order_id = paid.id
      left join d on d.order_no = paid.order_no
     group by paid.reg
     order by revenue desc
  )
  select coalesce(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) into result from agg;
  return result;
end $$;

grant execute on function public.sales_by_region(date, date, text) to authenticated;
