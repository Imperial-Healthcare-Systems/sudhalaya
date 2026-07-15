-- Suddhalaya backend — Phase 4.1: server-authoritative stock functions.
-- All stock movement is done here (SECURITY DEFINER). Staff-facing mutators enforce
-- has_perm() INTERNALLY so a direct PostgREST RPC call can't bypass the op guard.
-- deduct_fifo is an internal helper (no grant) called only by place_order.

-- guard used by the staff-facing functions
create or replace function public._require_warehouse() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('warehouse') or public.has_perm('inventory')) then
    raise exception 'Not authorized for inventory operations.';
  end if;
end $$;

-- Receive stock into a batch (creates or tops up the lot). Returns the batch id.
create or replace function public.receive_stock(
  p_variant_id bigint, p_warehouse_id bigint, p_batch_no text,
  p_mfg_date date, p_expiry_date date, p_qty int, p_cost_price numeric, p_actor text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_batch_id bigint;
begin
  perform public._require_warehouse();
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be positive.'; end if;

  insert into public.inventory_batches
    (variant_id, warehouse_id, batch_no, mfg_date, expiry_date, qty_received, qty_remaining, cost_price)
  values (p_variant_id, p_warehouse_id, p_batch_no, p_mfg_date, p_expiry_date, p_qty, p_qty, p_cost_price)
  on conflict (variant_id, warehouse_id, batch_no) do update
    set qty_received = public.inventory_batches.qty_received + p_qty,
        qty_remaining = public.inventory_batches.qty_remaining + p_qty,
        expiry_date = coalesce(excluded.expiry_date, public.inventory_batches.expiry_date),
        cost_price  = coalesce(excluded.cost_price,  public.inventory_batches.cost_price)
  returning id into v_batch_id;

  insert into public.stock_movements(batch_id, variant_id, warehouse_id, delta, reason, actor)
    values (v_batch_id, p_variant_id, p_warehouse_id, p_qty, 'receive', p_actor);
  return v_batch_id;
end $$;

-- Correct a batch's remaining quantity (damage / stock-take). Logs the delta.
create or replace function public.adjust_batch(
  p_batch_id bigint, p_new_remaining int, p_reason text, p_actor text, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare b public.inventory_batches; v_delta int; v_reason text;
begin
  perform public._require_warehouse();
  select * into b from public.inventory_batches where id = p_batch_id for update;
  if not found then raise exception 'Batch not found.'; end if;
  if p_new_remaining < 0 then raise exception 'Remaining cannot be negative.'; end if;
  if p_new_remaining > b.qty_received then raise exception 'Remaining cannot exceed received (%).', b.qty_received; end if;
  v_delta := p_new_remaining - b.qty_remaining;
  v_reason := case when p_reason in ('adjustment','damage') then p_reason else 'adjustment' end;
  update public.inventory_batches set qty_remaining = p_new_remaining where id = p_batch_id;
  insert into public.stock_movements(batch_id, variant_id, warehouse_id, delta, reason, actor, note)
    values (p_batch_id, b.variant_id, b.warehouse_id, v_delta, v_reason, p_actor, p_note);
end $$;

-- Move qty of a batch to another warehouse (splits the lot). Logs out+in.
create or replace function public.transfer_stock(
  p_batch_id bigint, p_to_warehouse_id bigint, p_qty int, p_actor text)
returns void
language plpgsql security definer set search_path = public as $$
declare b public.inventory_batches; v_dest_id bigint;
begin
  perform public._require_warehouse();
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be positive.'; end if;
  select * into b from public.inventory_batches where id = p_batch_id for update;
  if not found then raise exception 'Batch not found.'; end if;
  if b.warehouse_id = p_to_warehouse_id then raise exception 'Source and destination warehouse are the same.'; end if;
  if b.qty_remaining < p_qty then raise exception 'Only % remaining in this batch.', b.qty_remaining; end if;

  -- decrement source (both received & remaining so received stays >= remaining and totals are conserved)
  update public.inventory_batches
     set qty_received = qty_received - p_qty, qty_remaining = qty_remaining - p_qty
   where id = p_batch_id;
  insert into public.stock_movements(batch_id, variant_id, warehouse_id, delta, reason, actor, note)
    values (p_batch_id, b.variant_id, b.warehouse_id, -p_qty, 'transfer_out', p_actor, 'to warehouse '||p_to_warehouse_id);

  -- create/increment destination lot with same batch_no/mfg/expiry
  insert into public.inventory_batches
    (variant_id, warehouse_id, batch_no, mfg_date, expiry_date, qty_received, qty_remaining, cost_price)
  values (b.variant_id, p_to_warehouse_id, b.batch_no, b.mfg_date, b.expiry_date, p_qty, p_qty, b.cost_price)
  on conflict (variant_id, warehouse_id, batch_no) do update
    set qty_received = public.inventory_batches.qty_received + p_qty,
        qty_remaining = public.inventory_batches.qty_remaining + p_qty
  returning id into v_dest_id;
  insert into public.stock_movements(batch_id, variant_id, warehouse_id, delta, reason, actor, note)
    values (v_dest_id, b.variant_id, p_to_warehouse_id, p_qty, 'transfer_in', p_actor, 'from warehouse '||b.warehouse_id);
end $$;

-- FIFO picker: deduct p_qty from the variant's batches, oldest manufacture date first.
-- INTERNAL helper (no grant) — called by place_order which runs as the definer owner.
-- Raises if total remaining < requested. Returns [{batch_id, qty}, ...] consumed.
create or replace function public.deduct_fifo(
  p_variant_id bigint, p_qty int, p_order_no text, p_actor text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; v_need int := p_qty; v_take int; v_consumed jsonb := '[]'::jsonb;
begin
  if p_qty is null or p_qty <= 0 then return v_consumed; end if;
  for b in
    select id, qty_remaining, warehouse_id
      from public.inventory_batches
     where variant_id = p_variant_id and qty_remaining > 0
     order by mfg_date asc, id asc
     for update
  loop
    exit when v_need <= 0;
    v_take := least(b.qty_remaining, v_need);
    update public.inventory_batches set qty_remaining = qty_remaining - v_take where id = b.id;
    insert into public.stock_movements(batch_id, variant_id, warehouse_id, delta, reason, order_no, actor)
      values (b.id, p_variant_id, b.warehouse_id, -v_take, 'order', p_order_no, p_actor);
    v_consumed := v_consumed || jsonb_build_object('batch_id', b.id, 'qty', v_take);
    v_need := v_need - v_take;
  end loop;
  if v_need > 0 then
    raise exception 'Insufficient stock';   -- matches place_order's existing error path
  end if;
  return v_consumed;
end $$;

-- Restock returned units. They land in the variant's MOST-RECENT batch (highest
-- mfg_date); if the variant has no batch, a RETURNS lot is created in the default
-- warehouse. Logs reason='return_restock'.
create or replace function public.restock_batch(
  p_variant_id bigint, p_qty int, p_order_no text, p_actor text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_batch_id bigint; v_wh bigint;
begin
  perform public._require_warehouse();
  if p_qty is null or p_qty <= 0 then return; end if;
  select id into v_batch_id from public.inventory_batches
    where variant_id = p_variant_id order by mfg_date desc, id desc limit 1;
  if v_batch_id is null then
    select id into v_wh from public.warehouses where is_default order by id limit 1;
    if v_wh is null then select id into v_wh from public.warehouses where active order by id limit 1; end if;
    if v_wh is null then raise exception 'No warehouse configured for restock.'; end if;
    insert into public.inventory_batches
      (variant_id, warehouse_id, batch_no, mfg_date, expiry_date, qty_received, qty_remaining)
    values (p_variant_id, v_wh, 'RETURNS', current_date, null, p_qty, p_qty)
    returning id into v_batch_id;
  else
    update public.inventory_batches
       set qty_received = qty_received + p_qty, qty_remaining = qty_remaining + p_qty
     where id = v_batch_id;
  end if;
  insert into public.stock_movements(batch_id, variant_id, warehouse_id, delta, reason, order_no, actor)
    select v_batch_id, p_variant_id, b.warehouse_id, p_qty, 'return_restock', p_order_no, p_actor
    from public.inventory_batches b where b.id = v_batch_id;
end $$;

-- Staff-facing mutators are callable by logged-in staff (they enforce has_perm inside).
grant execute on function public.receive_stock(bigint,bigint,text,date,date,int,numeric,text) to authenticated;
grant execute on function public.adjust_batch(bigint,int,text,text,text) to authenticated;
grant execute on function public.transfer_stock(bigint,bigint,int,text) to authenticated;
grant execute on function public.restock_batch(bigint,int,text,text) to authenticated;
-- deduct_fifo is intentionally NOT granted (internal to place_order).
