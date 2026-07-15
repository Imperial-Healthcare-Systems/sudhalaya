-- Suddhalaya backend — Phase 4.1: RLS + 'warehouse' permission.
-- Redefines has_perm() here (do NOT edit 0002) to grant 'warehouse' to owner
-- (implicitly, via role='owner'), manager and fulfilment.

create or replace function public.has_perm(_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = auth.uid() and s.active
      and (s.role = 'owner' or _perm = any (
        case s.role
          when 'manager'    then array['orders','inventory','products','customers','returns','reports','coupons','categories','cms','warehouse']
          when 'fulfilment' then array['orders','inventory','returns','warehouse']
          when 'support'    then array['orders','customers','returns']
          when 'finance'    then array['orders','reports','payments']
          else array['view']
        end))
  );
$$;

alter table public.warehouses       enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.stock_movements  enable row level security;

-- warehouses: any active staff may read (dropdowns); warehouse/inventory staff may write
drop policy if exists warehouses_staff_read on public.warehouses;
create policy warehouses_staff_read on public.warehouses for select using (public.is_staff());
drop policy if exists warehouses_staff_write on public.warehouses;
create policy warehouses_staff_write on public.warehouses for all
  using (public.has_perm('warehouse') or public.has_perm('inventory'))
  with check (public.has_perm('warehouse') or public.has_perm('inventory'));

-- inventory_batches: read + write for warehouse/inventory staff
drop policy if exists batches_staff_read on public.inventory_batches;
create policy batches_staff_read on public.inventory_batches for select
  using (public.has_perm('warehouse') or public.has_perm('inventory'));
drop policy if exists batches_staff_write on public.inventory_batches;
create policy batches_staff_write on public.inventory_batches for all
  using (public.has_perm('warehouse') or public.has_perm('inventory'))
  with check (public.has_perm('warehouse') or public.has_perm('inventory'));

-- stock_movements: insert + select only (append-only; no update/delete policy)
drop policy if exists movements_staff_read on public.stock_movements;
create policy movements_staff_read on public.stock_movements for select
  using (public.has_perm('warehouse') or public.has_perm('inventory'));
drop policy if exists movements_staff_insert on public.stock_movements;
create policy movements_staff_insert on public.stock_movements for insert
  with check (public.has_perm('warehouse') or public.has_perm('inventory'));
