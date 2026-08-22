-- Suddhalaya backend — audit phase 0: payment + coupon integrity. Forward-only.
--
-- Closes four audit findings:
--
--   BUG-02 (P0) place_order marked every non-COD order `paid` on the client's word,
--          with a fabricated txn id and a real GST invoice number. /api/orders is
--          unauthenticated, so anyone could mint a fully-invoiced paid order.
--          => An order is NEVER born paid. Prepaid orders are created pending and
--             can only be marked paid by mark_order_paid(), which is service-role
--             only and is called from the signature-verified Razorpay callback.
--
--   BUG-07 (P1) invoice numbers were also issued by the admin console from a
--          per-browser localStorage counter, so they duplicated across machines.
--          => mark_order_paid() is now the single place a prepaid invoice number is
--             issued, always from the Postgres sequence, and it is idempotent.
--
--   BUG-11 (P1) coupons.cap (max discount) was captured, stored and advertised in
--          the UI ("15% off (max ₹200)") but never applied anywhere.
--          => least(disc, cap) in both validate_coupon and place_order.
--
--   BUG-12 (P1) place_order looked coupons up with upper(p_coupon) but wrote the
--          redemption ledger with the raw string, so per_user_limit never matched a
--          lowercase redemption.
--          => p_coupon is normalised once, up front, and used everywhere after.
--
-- Behaviour change to be aware of when deploying: a prepaid order now reaches
-- payment_status='paid' only after /api/razorpay/verify succeeds. COD is unchanged.

-- ---------------------------------------------------------------------------
-- 1. validate_coupon (4-arg) — apply the cap, and return it so the cart can too
-- ---------------------------------------------------------------------------
create or replace function public.validate_coupon(
  p_code text, p_subtotal numeric, p_user_email text, p_item_skus jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.coupons; v_email text := lower(coalesce(p_user_email,'')); v_eligible numeric; disc numeric := 0;
  v_applied jsonb;
begin
  select * into c from public.coupons where code = upper(trim(coalesce(p_code,''))) and active;
  if not found then return jsonb_build_object('valid', false, 'reason', 'Invalid code.'); end if;
  if c.expires is not null and c.expires < current_date then
    return jsonb_build_object('valid', false, 'reason', 'This code has expired.'); end if;
  if p_subtotal < c.min_cart then
    return jsonb_build_object('valid', false, 'reason', 'Add ₹'||(c.min_cart)::int||'+ to use this code.'); end if;

  -- user scope
  if c.scope in ('users','user_products') then
    if v_email = '' or not (c.user_emails ? v_email) then
      return jsonb_build_object('valid', false, 'reason', 'This code isn''t available on your account.'); end if;
  end if;

  -- per-user limit
  if c.per_user_limit > 0 and v_email <> '' then
    if (select count(*) from public.coupon_redemptions r
         where upper(r.code) = c.code and lower(r.user_email) = v_email) >= c.per_user_limit then
      return jsonb_build_object('valid', false, 'reason', 'You''ve already used this code.'); end if;
  end if;

  -- product scope: discount applies to the eligible subtotal only
  if c.scope in ('products','user_products') then
    select coalesce(sum((li->>'amount')::numeric),0),
           coalesce(jsonb_agg(li->>'sku'),'[]'::jsonb)
      into v_eligible, v_applied
      from jsonb_array_elements(coalesce(p_item_skus,'[]'::jsonb)) li
      where c.product_skus ? (li->>'sku');
    if coalesce(v_eligible,0) <= 0 then
      return jsonb_build_object('valid', false, 'reason', 'This code applies to products not in your cart.'); end if;
  else
    v_eligible := p_subtotal; v_applied := null;
  end if;

  if c.type = 'pct' then disc := round(v_eligible * c.value/100, 2);
  else disc := least(c.value, v_eligible); end if;

  -- BUG-11: honour the advertised maximum discount
  if coalesce(c.cap, 0) > 0 then disc := least(disc, c.cap); end if;

  return jsonb_build_object('valid', true, 'code', c.code, 'type', c.type, 'value', c.value,
    'desc', c.description, 'discount', disc, 'minCart', c.min_cart, 'cap', coalesce(c.cap, 0),
    'scope', c.scope, 'productSkus', c.product_skus, 'appliedSkus', v_applied);
end $$;

-- ---------------------------------------------------------------------------
-- 2. place_order — never born paid; normalised coupon code; capped discount
--    (otherwise identical to 0015: FIFO, draft guard, scope-aware coupon, ledger)
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
  v_free numeric; v_flat numeric; v_cod_enabled boolean; v_cod_max numeric;
  v_item jsonb; v_variant record;
  v_qty int; v_gross numeric := 0; v_ship_products numeric := 0;
  v_seen bigint[] := '{}';
  v_disc numeric := 0; v_after numeric; v_tax numeric := 0; v_base numeric; v_ship numeric := 0; v_total numeric;
  v_uid uuid := auth.uid();
  v_order_no text; v_is_cod boolean; v_status text; v_order_id uuid;
  v_coupon record; v_now text; v_lines jsonb := '[]'::jsonb; v_cust_id bigint;
  v_line record; v_email text := lower(coalesce(p_customer->>'email','')); v_eligible numeric; v_ok boolean;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  -- BUG-12: normalise the coupon code ONCE so the lookup, the limit check and the
  -- ledger row can never disagree about case.
  p_coupon := nullif(upper(trim(coalesce(p_coupon, ''))), '');

  select value into v_settings from public.app_config where key = 'settings';
  v_free        := coalesce((v_settings->>'freeShipThreshold')::numeric, 999);
  v_flat        := coalesce((v_settings->>'flatShip')::numeric, 60);
  v_cod_enabled := coalesce((v_settings->>'codEnabled')::boolean, true);
  v_cod_max     := coalesce((v_settings->>'codMaxOrder')::numeric, 0);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));
    select pv.id as vid, pv.sku, pv.label, pv.price, pv.stock,
           p.id as pid, p.gst as pgst, p.name as pname, p.ship_fee as pship, p.draft as pdraft
      into v_variant
      from public.product_variants pv join public.products p on p.id = pv.product_id
      where pv.sku = (v_item->>'sku') for update;
    if not found then raise exception 'Unknown item: %', (v_item->>'sku'); end if;
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

  if p_coupon is not null then
    select * into v_coupon from public.coupons where code = p_coupon and active;
    if found then
      v_ok := true;
      if v_gross < v_coupon.min_cart then v_ok := false; end if;
      if v_coupon.expires is not null and v_coupon.expires < current_date then v_ok := false; end if;
      if v_coupon.scope in ('users','user_products') and (v_email = '' or not (v_coupon.user_emails ? v_email)) then v_ok := false; end if;
      if v_coupon.per_user_limit > 0 and v_email <> ''
         and (select count(*) from public.coupon_redemptions r
               where upper(r.code) = v_coupon.code and lower(r.user_email) = v_email) >= v_coupon.per_user_limit
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
        -- BUG-11: honour the advertised maximum discount
        if coalesce(v_coupon.cap, 0) > 0 then v_disc := least(v_disc, v_coupon.cap); end if;
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

  v_is_cod := (p_payment_method = 'cod');

  if v_is_cod and (not v_cod_enabled or (v_cod_max > 0 and v_total > v_cod_max)) then
    raise exception 'Cash on Delivery is not available for this order.';
  end if;

  -- BUG-02: an order is never born paid. Both COD and prepaid start pending; a
  -- prepaid order becomes paid only via mark_order_paid() after the Razorpay
  -- signature has been verified server-side. No fabricated txn id, no invoice.
  v_status   := 'payment-pending';
  v_order_no := '#SDL' || nextval('public.order_no_seq');
  v_now      := to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI');

  insert into public.orders(
      order_no, user_id, customer_name, email, phone, ship_name, ship_line, ship_city, ship_state, ship_pin,
      payment_method, payment_status, payment_txn_id, payment_gateway, payment_captured_at,
      coupon_code, subtotal, tax_total, ship_total, total, status, placed_at)
  values(
      v_order_no, v_uid, p_customer->>'name', p_customer->>'email', p_customer->>'phone',
      coalesce(p_ship->>'name', p_customer->>'name'), p_ship->>'line', p_ship->>'city', p_ship->>'state', p_ship->>'pin',
      p_payment_method, 'pending',
      '',
      case when v_is_cod then 'COD' else 'Razorpay' end,
      '',
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
    values (v_order_id, v_now, 'customer',
            'Order placed' || case when v_is_cod then ' (COD)' else ' — awaiting payment' end);

  insert into public.customers(name, email, phone, city, since, user_id)
    values (p_customer->>'name', p_customer->>'email', p_customer->>'phone',
            p_ship->>'city', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY'), v_uid)
    on conflict (email) do update set phone = excluded.phone, name = excluded.name
    returning id into v_cust_id;
  if v_cust_id is not null then update public.orders set customer_id = v_cust_id where id = v_order_id; end if;

  return jsonb_build_object(
    'ok', true, 'id', v_order_id, 'order_no', v_order_no, 'status', v_status,
    'payment_status', 'pending', 'discount', v_disc,
    'subtotal', v_base, 'tax', v_tax, 'ship', v_ship, 'total', v_total, 'invoice', null);
end $$;

grant execute on function public.place_order(jsonb, jsonb, jsonb, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. mark_order_paid — the ONLY way an order becomes paid, and the only place a
--    prepaid GST invoice number is issued. Service-role only: it is called from
--    /api/razorpay/verify after the HMAC signature has been checked.
--    Idempotent — replaying it does not burn a second invoice number.
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_paid(
  p_order_no text, p_txn_id text, p_gateway text default 'Razorpay')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o record; v_invoice text; v_now text; v_prefix text; v_gw text := coalesce(nullif(p_gateway,''), 'Razorpay');
begin
  select o.id, o.payment_status, o.payment_invoice, o.status
    into v_o
    from public.orders o
   where o.order_no = p_order_no
   for update;
  if not found then raise exception 'Order % not found', p_order_no; end if;

  if v_o.payment_status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'order_no', p_order_no,
      'payment_status', 'paid', 'invoice', v_o.payment_invoice, 'status', v_o.status);
  end if;

  v_now := to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI');
  select value->>'invoicePrefix' into v_prefix from public.app_config where key = 'settings';
  v_invoice := coalesce(
    nullif(v_o.payment_invoice, ''),
    coalesce(v_prefix, 'INV-2026-') || lpad(nextval('public.invoice_seq')::text, 4, '0'));

  update public.orders
     set payment_status      = 'paid',
         payment_txn_id      = p_txn_id,
         payment_gateway     = v_gw,
         payment_captured_at = v_now,
         payment_invoice     = v_invoice,
         status              = case when status = 'payment-pending' then 'processing' else status end
   where id = v_o.id;

  insert into public.order_events(order_id, at, actor, note) values
    (v_o.id, v_now, 'system', 'Payment captured (' || v_gw || ')'),
    (v_o.id, v_now, 'system', 'GST invoice ' || v_invoice || ' generated');

  return jsonb_build_object('ok', true, 'order_no', p_order_no, 'payment_status', 'paid',
    'invoice', v_invoice, 'status', 'processing', 'captured_at', v_now);
end $$;

-- Never callable by a shopper or a staff session — service role only.
revoke all on function public.mark_order_paid(text, text, text) from public, anon, authenticated;

comment on function public.mark_order_paid(text, text, text) is
  'Marks an order paid and issues its GST invoice number. Service-role only; called from the signature-verified Razorpay callback. Idempotent.';
