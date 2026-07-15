-- Suddhalaya backend — Phase 4.1: warehouses + batch/manufacture-date inventory.
-- Batches hold the authoritative stock. product_variants.stock is kept as a CACHED
-- MIRROR (= SUM of the variant's batch qty_remaining) so all existing storefront code
-- that reads variant.stock / p.stock keeps working unchanged.
-- Additive + idempotent + forward-only.

-- ---------------------------------------------------------------------------
-- warehouses
-- ---------------------------------------------------------------------------
create table if not exists public.warehouses (
  id         bigint generated always as identity primary key,
  name       text not null,
  code       text not null unique,
  city       text,
  state      text,
  pincode    text,
  address    text,
  active     boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- at most one default warehouse
create unique index if not exists warehouses_one_default on public.warehouses (is_default) where is_default;
drop trigger if exists warehouses_set_updated on public.warehouses;
create trigger warehouses_set_updated before update on public.warehouses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- inventory_batches — the stock-holding table
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_batches (
  id           bigint generated always as identity primary key,
  variant_id   bigint not null references public.product_variants(id) on delete cascade,
  warehouse_id bigint not null references public.warehouses(id),
  batch_no     text not null,
  mfg_date     date not null,
  expiry_date  date,
  qty_received int not null check (qty_received >= 0),
  qty_remaining int not null check (qty_remaining >= 0 and qty_remaining <= qty_received),
  cost_price   numeric(10,2),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (variant_id, warehouse_id, batch_no)
);
create index if not exists inventory_batches_fifo_idx on public.inventory_batches (variant_id, mfg_date, id);
create index if not exists inventory_batches_wh_idx  on public.inventory_batches (warehouse_id);
drop trigger if exists inventory_batches_set_updated on public.inventory_batches;
create trigger inventory_batches_set_updated before update on public.inventory_batches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- stock_movements — append-only audit of every stock change
-- ---------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id           bigint generated always as identity primary key,
  batch_id     bigint references public.inventory_batches(id) on delete set null,
  variant_id   bigint,
  warehouse_id bigint,
  delta        int not null,                 -- negative = out, positive = in
  reason       text not null check (reason in
                 ('receive','order','return_restock','adjustment','transfer_out','transfer_in','damage')),
  order_no     text,
  actor        text,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists stock_movements_variant_idx on public.stock_movements (variant_id);
create index if not exists stock_movements_created_idx  on public.stock_movements (created_at);

-- ---------------------------------------------------------------------------
-- Mirror: keep product_variants.stock = SUM(batch qty_remaining).
-- NON-RECURSIVE: this AFTER trigger fires on inventory_batches and updates
-- product_variants only. product_variants has no trigger that writes back to
-- inventory_batches, so there is no trigger loop. Statement-level would also work;
-- row-level is used for simplicity (recompute is idempotent).
-- ---------------------------------------------------------------------------
create or replace function public.sync_variant_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare vid bigint := coalesce(new.variant_id, old.variant_id);
begin
  update public.product_variants pv
     set stock = coalesce((select sum(b.qty_remaining)
                             from public.inventory_batches b
                            where b.variant_id = vid), 0)
   where pv.id = vid;
  return null;
end $$;

drop trigger if exists inventory_batches_sync on public.inventory_batches;
create trigger inventory_batches_sync
  after insert or update or delete on public.inventory_batches
  for each row execute function public.sync_variant_stock();
