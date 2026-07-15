-- Suddhalaya backend — QA fixes (security + correctness). Additive, forward-only.
--
-- FIX 1 (CRITICAL): deduct_fifo was callable by anon/authenticated.
--   Postgres grants EXECUTE on new functions to PUBLIC by default, so simply "not
--   granting" it was NOT enough — an anonymous caller could drain batch stock without
--   placing an order. Revoke it from PUBLIC/anon/authenticated. place_order still works
--   because it is SECURITY DEFINER (runs as the function owner, which retains EXECUTE).
--   The same hardening is applied to the other internal helpers.
--
-- FIX 2 (MEDIUM): place_order did not check products.draft, so an unpublished/archived
--   product could still be ordered by anyone who knew its variant SKU. Now rejected.

-- ---------------------------------------------------------------------------
-- FIX 1 — lock down internal functions
-- ---------------------------------------------------------------------------
revoke all on function public.deduct_fifo(bigint, int, text, text) from public, anon, authenticated;
revoke all on function public.sync_variant_stock() from public, anon, authenticated;
revoke all on function public._require_warehouse() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- FIX 2 — place_order rejects draft/unpublished products
-- (identical to 0012 otherwise: FIFO + scope-aware coupon + redemption ledger)
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_items          jsonb,
  p_customer       jsonb,
  p_ship           jsonb,
  p_payment_method text,
  p_coupon         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_settings   jsonb;
  v_free numeric; v_flat numeric; v_cod_enabled boolean; v_cod_max numeric; v_inv_prefix text;
  v_item jsonb; v_variant record;
  v_qty int; v_gross numeric := 0; v_ship_products numeric := 0;
  v_seen bigint[] := '{}';
  v_disc numeric := 0; v_after numeric; v_tax numeric := 0; v_base numeric; v_ship numeric := 0; v_total numeric;
  v_uid uuid := auth.uid();
  v_order_no text; v_invoice text; v_paid boolean; v_status text; v_order_id uuid;
  v_coupon record; v_now text; v_lines jsonb := '[]'::jsonb; v_cust_id bigint;
  v_line record; v_email text := lower(coalesce(p_customer->>'email','')); v_eligible numeric; v_ok boolean;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  select value into v_settings from public.app_config where key = 'settings';
  v_free        := coalesce((v_settings->>'freeShipThreshold')::numeric, 999);
  v_flat        := coalesce((v_settings->>'flatShip')::numeric, 60);
  v_cod_enabled := coalesce((v_settings->>'codEnabled')::boolean, true);
  v_cod_max     := coalesce((v_settings->>'codMaxOrder')::numeric, 0);
  v_inv_prefix  := coalesce(v_settings->>'invoicePrefix', 'INV-2026-');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));
    select pv.id as vid, pv.sku, pv.label, pv.price, pv.stock,
           p.id as pid, p.gst as pgst, p.name as pname, p.ship_fee as pship, p.draft as pdraft
      into v_variant
      from public.product_variants pv join public.products p on p.id = pv.product_id
      where pv.sku = (v_item->>'sku') for update;
    if not found then raise exception 'Unknown item: %', (v_item->>'sku'); end if;
    -- FIX 2: unpublished/archived products are not purchasable
    if v_variant.pdraft then raise exception 'This product is not available: %', v_variant.sku; end if;
    if v_variant.stock < v_qty then raise exception 'Insufficient stock for %', v_variant.sku; end if;
    v_gross := v_gross + v_variant.price * v_qty;
    if not (v_variant.pid = any (v_seen)) then
      v_seen := array_append(v_seen, v_variant.pid);
      v_ship_products := v_ship_products + coalesce(v_variant.pship, 0);
    end if;
    v_lines := v_lines || jsonb_build_object(
      'vid', v_variant.vid, 'sku', v_variant.sku, 'name', v_variant.pname, 'variant', v_variant.label,
      'qty', v_qty, 'price', v_variant.price, 'gst', v_variant.pgst);
  end loop;

  if p_coupon is not null and length(p_coupon) > 0 then
    select * into v_coupon from public.coupons where code = upper(p_coupon) and active;
    if found then
      v_ok := true;
      if v_gross < v_coupon.min_cart then v_ok := false; end if;
      if v_coupon.expires is not null and v_coupon.expires < current_date then v_ok := false; end if;
      if v_coupon.scope in ('users','user_products') and (v_email = '' or not (v_coupon.user_emails ? v_email)) then v_ok := false; end if;
      if v_coupon.per_user_limit > 0 and v_email <> ''
         and (select count(*) from public.coupon_redemptions r where r.code = v_coupon.code and lower(r.user_email) = v_email) >= v_coupon.per_user_limit
      then v_ok := false; end if;
      if v_coupon.scope in ('products','user_products') then
        select coalesce(sum(li.qty * li.price), 0) into v_eligible
          from jsonb_to_recordset(v_lines) as li(sku text, qty int, price numeric)
          where v_coupon.product_skus ? li.sku;
        if coalesce(v_eligible,0) <= 0 then v_ok := false; end if;
      else
        v_eligible := v_gross;
      end if;
      if v_ok then
        if v_coupon.type = 'pct' then v_disc := round(v_eligible * v_coupon.value/100, 2);
        else v_disc := least(v_coupon.value, v_eligible); end if;
        update public.coupons set uses = uses + 1 where code = v_coupon.code;
      else
        p_coupon := null; v_disc := 0;
      end if;
    else
      p_coupon := null;
    end if;
  end if;

  v_after := round(v_gross - v_disc, 2);

  select coalesce(sum(
           (li.qty * li.price * (v_after / nullif(v_gross,0)))
           - (li.qty * li.price * (v_after / nullif(v_gross,0))) / (1 + li.gst/100.0)
         ), 0)
    into v_tax
    from jsonb_to_recordset(v_lines) as li(qty int, price numeric, gst numeric);
  v_tax  := round(coalesce(v_tax, 0), 2);
  v_base := round(v_after - v_tax, 2);

  if v_free > 0 and v_after >= v_free then v_ship := 0;
  else v_ship := round(v_flat + v_ship_products, 2); end if;
  v_total := round(v_base + v_tax + v_ship, 2);

  if p_payment_method = 'cod' and (not v_cod_enabled or (v_cod_max > 0 and v_total > v_cod_max)) then
    raise exception 'Cash on Delivery is not available for this order.';
  end if;

  v_paid     := p_payment_method <> 'cod';
  v_status   := case when v_paid then 'processing' else 'payment-pending' end;
  v_order_no := '#SDL' || nextval('public.order_no_seq');
  v_now      := to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI');

  insert into public.orders(
      order_no, user_id, customer_name, email, phone, ship_name, ship_line, ship_city, ship_state, ship_pin,
      payment_method, payment_status, payment_txn_id, payment_gateway, payment_captured_at,
      coupon_code, subtotal, tax_total, ship_total, total, status, placed_at)
  values(
      v_order_no, v_uid, p_customer->>'name', p_customer->>'email', p_customer->>'phone',
      coalesce(p_ship->>'name', p_customer->>'name'), p_ship->>'line', p_ship->>'city', p_ship->>'state', p_ship->>'pin',
      p_payment_method, case when v_paid then 'paid' else 'pending' end,
      case when v_paid then 'pay_'||substr(md5(random()::text),1,10) else '' end,
      case when v_paid then 'Razorpay' else 'COD' end,
      case when v_paid then v_now else '' end,
      p_coupon, v_base, v_tax, v_ship, v_total, v_status, now())
  returning id into v_order_id;

  insert into public.order_items(order_id, sku, name, variant, qty, price, gst)
    select v_order_id, li.sku, li.name, li.variant, li.qty, li.price, li.gst
    from jsonb_to_recordset(v_lines) as li(sku text, name text, variant text, qty int, price numeric, gst numeric);

  for v_line in select * from jsonb_to_recordset(v_lines) as x(vid bigint, qty int) loop
    perform public.deduct_fifo(v_line.vid, v_line.qty, v_order_no, coalesce(p_customer->>'name','customer'));
  end loop;

  if p_coupon is not null then
    insert into public.coupon_redemptions(code, user_email, order_no, discount)
      values (p_coupon, v_email, v_order_no, v_disc);
  end if;

  insert into public.order_events(order_id, at, actor, note)
    values (v_order_id, v_now, 'customer', 'Order placed' || case when v_paid then '' else ' (COD)' end);
  if v_paid then
    v_invoice := v_inv_prefix || lpad(nextval('public.invoice_seq')::text, 4, '0');
    update public.orders set payment_invoice = v_invoice where id = v_order_id;
    insert into public.order_events(order_id, at, actor, note)
      values (v_order_id, v_now, 'system', 'Payment captured (Razorpay)'),
             (v_order_id, v_now, 'system', 'GST invoice ' || v_invoice || ' generated');
  end if;

  insert into public.customers(name, email, phone, city, since, user_id)
    values (p_customer->>'name', p_customer->>'email', p_customer->>'phone',
            p_ship->>'city', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY'), v_uid)
    on conflict (email) do update set phone = excluded.phone, name = excluded.name
    returning id into v_cust_id;
  if v_cust_id is not null then update public.orders set customer_id = v_cust_id where id = v_order_id; end if;

  return jsonb_build_object(
    'ok', true, 'id', v_order_id, 'order_no', v_order_no, 'status', v_status,
    'payment_status', case when v_paid then 'paid' else 'pending' end,
    'subtotal', v_base, 'tax', v_tax, 'ship', v_ship, 'total', v_total, 'invoice', v_invoice);
end $$;

grant execute on function public.place_order(jsonb, jsonb, jsonb, text, text) to anon, authenticated;
