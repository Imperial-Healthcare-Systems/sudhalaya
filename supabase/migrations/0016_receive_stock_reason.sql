-- Suddhalaya backend — stock-in "Source" (audit reason) on receive_stock.
--
-- WHY: receive_stock hard-coded reason='receive', so a customer return / RTO / stock-take
-- find was logged as a SUPPLIER RECEIPT — corrupting "how much did we purchase?" and the
-- cost_price data used for margin reporting. adjust_batch also cannot correct stock UPWARD
-- (it rejects new_remaining > qty_received), so there was no correct path for units coming
-- back outside an order refund. One validated p_reason parameter fixes both.
--
-- Note: the 8-arg form is dropped first so the new 9-arg (defaulted) form isn't an
-- ambiguous overload for PostgREST RPC resolution.

drop function if exists public.receive_stock(bigint, bigint, text, date, date, int, numeric, text);

create or replace function public.receive_stock(
  p_variant_id bigint, p_warehouse_id bigint, p_batch_no text,
  p_mfg_date date, p_expiry_date date, p_qty int, p_cost_price numeric, p_actor text,
  p_reason text default 'receive')
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_batch_id bigint; v_reason text;
begin
  perform public._require_warehouse();
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be positive.'; end if;

  -- only stock-IN reasons are valid here; anything else falls back to a plain receipt
  v_reason := case when p_reason in ('receive','return_restock','adjustment')
                   then p_reason else 'receive' end;

  insert into public.inventory_batches
    (variant_id, warehouse_id, batch_no, mfg_date, expiry_date, qty_received, qty_remaining, cost_price)
  values (p_variant_id, p_warehouse_id, p_batch_no, p_mfg_date, p_expiry_date, p_qty, p_qty, p_cost_price)
  on conflict (variant_id, warehouse_id, batch_no) do update
    set qty_received  = public.inventory_batches.qty_received  + p_qty,
        qty_remaining = public.inventory_batches.qty_remaining + p_qty,
        expiry_date = coalesce(excluded.expiry_date, public.inventory_batches.expiry_date),
        cost_price  = coalesce(excluded.cost_price,  public.inventory_batches.cost_price)
  returning id into v_batch_id;

  insert into public.stock_movements(batch_id, variant_id, warehouse_id, delta, reason, actor)
    values (v_batch_id, p_variant_id, p_warehouse_id, p_qty, v_reason, p_actor);
  return v_batch_id;
end $$;

grant execute on function public.receive_stock(bigint, bigint, text, date, date, int, numeric, text, text) to authenticated;
