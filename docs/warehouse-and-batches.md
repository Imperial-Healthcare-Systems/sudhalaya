# Suddhalaya — Warehouse & Batch Management

How stock actually works in this system: where it lives, how it's consumed, who can touch it,
and what happens offline.

> **One-line summary:** Batches hold the stock. A variant's `stock` number is just a cached
> mirror of its batches. Orders consume batches **oldest manufacture-date first (FIFO)**, and
> every single movement is written to an append-only audit trail.

---

## 1. The mental model

Before Phase 4, stock was a single integer per variant (`product_variants.stock`). You couldn't
answer "which lot is this from?", "when was it made?", "when does it expire?" or "which warehouse
is it in?" — all of which matter for food products.

Now:

```
product  (A2 Desi Cow Ghee)
└── product_variant  (250 ml, SKU SDL-GHEE-250)   ← price/MRP live here; `stock` is a MIRROR
    ├── batch  B-2026-07  mfg 2026-07-01  exp 2027-07-01  Main Warehouse   remaining 18
    ├── batch  B-2026-05  mfg 2026-05-02  exp 2027-05-02  Main Warehouse   remaining  6
    └── batch  B-2026-05  mfg 2026-05-02  exp 2027-05-02  North Hub        remaining  4
                                                          variant.stock  =  28  (derived)
```

**The mirror is the key design decision.** The whole storefront (product cards, "Only 3 left",
PDP stock line, cart max-qty) reads `variant.stock` / `product.stock`. Rather than rewrite all of
that, batches became the source of truth and `variant.stock` is kept automatically in sync as a
**cached derived value**. Every existing stock read keeps working unchanged.

---

## 2. Data model

### `warehouses`
| column | notes |
|---|---|
| `id`, `name`, `code` | `code` is unique (e.g. `MAIN`, `NORTH`) |
| `city`, `state`, `pincode`, `address` | location |
| `active` | deactivating hides it from dropdowns (we never hard-delete — batches reference it) |
| `is_default` | **at most one**, enforced by a partial unique index. Used for restocks/backfill |

### `inventory_batches` — the stock-holding table
| column | notes |
|---|---|
| `variant_id` → `product_variants` | cascade delete |
| `warehouse_id` → `warehouses` | which location holds this lot |
| `batch_no` | human lot number, e.g. `B-2026-07` |
| `mfg_date` | **drives FIFO ordering** |
| `expiry_date` | nullable — staples like salt have none |
| `qty_received` | how many came in |
| `qty_remaining` | how many are left — `CHECK (0 <= qty_remaining <= qty_received)` |
| `cost_price` | optional, for future margin reporting |

- `UNIQUE (variant_id, warehouse_id, batch_no)` — the same lot can't be entered twice; receiving
  the same lot again **tops it up** instead of duplicating.
- Index on `(variant_id, mfg_date, id)` — this is the FIFO pick path.

### `stock_movements` — append-only audit
Every change writes a row: `delta` (negative = out, positive = in) plus a `reason`:

`receive` · `order` · `return_restock` · `adjustment` · `transfer_out` · `transfer_in` · `damage`

Plus `order_no`, `actor`, `note`, `created_at`. There is **no update/delete policy** — it's an
immutable ledger. Any stock number can always be explained by replaying these rows.

---

## 3. The mirror trigger (and why it can't loop)

```sql
create trigger inventory_batches_sync
  after insert or update or delete on public.inventory_batches
  for each row execute function public.sync_variant_stock();
```

`sync_variant_stock()` recomputes:

```sql
update product_variants pv
   set stock = coalesce((select sum(b.qty_remaining)
                           from inventory_batches b
                          where b.variant_id = vid), 0)
 where pv.id = vid;
```

**Why this is non-recursive:** the trigger fires on `inventory_batches` and only ever writes to
`product_variants`. `product_variants` has no trigger that writes back to `inventory_batches`, so
there's no cycle. It's also idempotent — recomputing the sum twice yields the same answer, which
is why a simple row-level trigger is safe even when one operation touches several batches.

**Consequence worth knowing:** never set `product_variants.stock` directly once batches exist —
it will be overwritten the next time any batch for that variant changes. Change stock by changing
batches (receive / adjust / order / restock).

---

## 4. FIFO fulfilment — `deduct_fifo()`

The heart of it. When an order is placed, for each line:

```sql
select id, qty_remaining, warehouse_id
  from inventory_batches
 where variant_id = p_variant_id and qty_remaining > 0
 order by mfg_date asc, id asc      -- OLDEST STOCK FIRST
 for update                          -- row locks: concurrent orders can't double-spend
```

It walks batches in that order, taking `min(batch.qty_remaining, still_needed)` from each,
**spanning multiple batches** if one can't cover the line. Each batch it touches gets its own
`stock_movements` row (`reason='order'`, with the `order_no`). If the batches can't cover the
quantity it `RAISE`s `'Insufficient stock'`, which rolls the whole order back (the function is
atomic — no partial orders, no partial deductions).

### Worked example (this is a real verified run)
```
SDL-GHEE-250:  INIT     mfg 2026-07-10   remaining 29
               OLD-TEST mfg 2026-01-01   remaining  5     → variant.stock = 34

Customer orders qty 3
  → FIFO picks OLD-TEST first (older mfg): 5 → 2
  → INIT untouched:                       29 → 29
  → variant.stock mirror                        = 31
  → stock_movements: (OLD-TEST, -3, 'order', '#SDL2046')
```
If they'd ordered 7, it would have taken all 5 from OLD-TEST and 2 from INIT, writing two
movement rows.

---

## 5. The operations

| Operation | Function | What it does |
|---|---|---|
| **Add to stock** | `receive_stock(variant, warehouse, batch_no, mfg, expiry, qty, cost, actor, reason)` | Creates the lot, or tops up an existing one (`qty_received += `, `qty_remaining += `). The **Source** picker sets the audit `reason` — see below. |
| **Adjust** | `adjust_batch(batch_id, new_remaining, reason, actor, note)` | **Downward** correction only (stock-take shrinkage / damage). Rejects `> qty_received`. Logs the signed delta as `adjustment` or `damage`. To correct **upward**, use *Add to stock → Found in stock-take*. |
| **Transfer** | `transfer_stock(batch_id, to_warehouse, qty, actor)` | Decrements **both** `qty_received` and `qty_remaining` at source, creates/increments the same lot at the destination. Logs `transfer_out` + `transfer_in`. Totals are conserved. |
| **Consume** | `deduct_fifo(variant, qty, order_no, actor)` | FIFO pick (above). **Internal only** — called by `place_order`. |
| **Restock** | `restock_batch(variant, qty, order_no, actor)` | Returns/cancellations. Units land in the variant's **most-recent batch** (highest `mfg_date`); if the variant has no batch, a `RETURNS` lot is created in the default warehouse. Logs `return_restock`. |

> **Restock design choice:** `restock_batch` (the *automatic* path) puts returned units back into
> the newest lot rather than guessing which lot they came from. The order's own movement rows
> record exactly which batches were consumed, so true lot-level reversal is possible later if
> needed — but for a food business, returned goods realistically re-enter as current stock, and
> this keeps the invariant `qty_remaining <= qty_received` intact without inventing a fake lot
> per return.

### Stock-in "Source" (audit reason)

There is deliberately **no separate "Restock" button**. Refunds and cancellations already restock
automatically, so a second manual button would duplicate the flow and invite **double-counting**.
Instead, the single *Add to stock* form carries a **Source** picker that sets the audit reason:

| Source (UI) | `reason` logged | Use for |
|---|---|---|
| Supplier receipt — new stock purchased | `receive` | Normal inbound purchase (carries `cost_price`) |
| Customer return / RTO — goods coming back | `return_restock` | Units back **outside** an order refund (e.g. courier RTO, exchange) |
| Found in stock-take — correction | `adjustment` | Upward correction when a count finds more than the system says |

Why this matters: before this, every stock-in was logged as `receive`, so a customer return
inflated "how much did we purchase?" and polluted the `cost_price` data used for margin
reporting. The reason is **validated server-side** against that allow-list (anything else falls
back to `receive`), so it can't be injected. It also beats `restock_batch`'s newest-lot heuristic
for manual returns — you can target the **exact lot**, since the batch number is printed on the jar.

⚠️ **Don't double-count:** a refund/cancel already restocks. Only use *Customer return* here for
goods arriving outside that flow.

---

## 6. How an order flows end-to-end

```
Storefront: POST /api/orders  { items:[{sku,qty}], customer, ship, payment_method, coupon }
   │
   ▼
place_order()  [SECURITY DEFINER — server-authoritative, atomic]
   1. Look up each variant BY SKU, lock the row (FOR UPDATE)
   2. Reject: unknown SKU · draft/unpublished product · stock < qty · empty cart
   3. Compute money server-side: GST-inclusive split, coupon (scope-aware), shipping
      (free over threshold, else flat + per-product surcharge), COD gate
   4. INSERT order + order_items
   5. ► for each line: deduct_fifo(variant, qty, order_no)   ← batches consumed here
   6. INSERT coupon_redemption (if a coupon applied)
   7. INSERT order_events (timeline) + GST invoice number
   8. UPSERT the CRM customer, link it
   9. RETURN { ok, order_no, subtotal, tax, ship, total, invoice, ... }
```

Anything raising at any step rolls back **everything** — order, items, and stock. Prices, GST,
shipping and stock are never trusted from the client.

**Returns:** admin refund/cancel → `order.status` op with a `restock` array → `restock_batch()`
per line → units back in stock, `return_restock` logged.

---

## 7. Security model

- **RLS** on all three tables. Read/write requires `has_perm('warehouse')` or `has_perm('inventory')`.
  `warehouses` is readable by any active staff (for dropdowns). `stock_movements` is
  select + insert only — no update/delete policy, so the ledger can't be rewritten.
- **Roles** (`0008` redefines `has_perm`): `owner` (all), `manager`, `fulfilment` get `warehouse`.
  `support` / `finance` / `readonly` do not.
- **Staff-facing functions enforce permission internally** (`_require_warehouse()`), so calling
  the RPC directly via PostgREST can't bypass the admin route's guard.
- **`deduct_fifo` is locked down.** This was a real QA finding: Postgres grants `EXECUTE` to
  `PUBLIC` **by default**, so simply *not granting* it left it callable by anonymous users — who
  could have drained stock without ordering. `0015` `REVOKE`s it (plus `sync_variant_stock` and
  `_require_warehouse`). `place_order` still calls it fine because `place_order` is
  `SECURITY DEFINER` and runs as the function owner, which retains EXECUTE.
- **Admin writes** go through `POST /api/admin/op` (`warehouse.upsert|delete`,
  `batch.receive|adjust|transfer`) using the **staff session client**, so RLS — not application
  code — is the real gate. The service role is never used for these writes.

---

## 8. Admin UI (Inventory tab)

- **Warehouses sub-view** (🏬 button) — list/add/edit, mark default, activate/deactivate.
  "Delete" is a soft-deactivate because batches reference the warehouse.
- **📦 Batches** per product row — opens a modal with a variant switcher and a table of
  batch no / mfg / expiry / warehouse / received / remaining, plus:
  - **Add to stock** form (batch no, warehouse, **Source**, mfg, expiry, qty, optional cost)
  - **Adjust remaining** (✎) — downward stock-take/damage correction
  - **Transfer** (⇄) — move units to another warehouse
- **Expiry warnings**: amber for lots expiring within 30 days, red for expired
  (`batchExpiryState()`).
- The existing per-variant stock number in the table is the mirror, so it updates automatically
  after any batch operation.

Reads come from `GET /api/admin/inventory?variant_id=` (batches + last 50 movements);
`warehouses` ride along in `GET /api/admin/data`.

---

## 9. Offline fallback (no backend)

The app must still run with `configured:false`. Offline, batches are modelled as an array on the
variant (`v.batches`) inside the existing `sdl_admin_v1__` localStorage store:

- `variantRemaining(v)` — sum of batch `remaining`, or plain `v.stock` if the variant has no batches.
- `deductVariantOffline(v, qty)` — JS FIFO: sorts by `mfgDate` and drains oldest first, then
  refreshes the `v.stock` mirror. Falls back to a plain decrement for variants without batches.
- `offlineReceive()` / adjust / transfer mutate the arrays and re-derive the mirror.

So the demo has behavioural parity: receive a lot, order, and the oldest lot drains first — with
no database at all.

---

## 10. Migration & backfill

`0010` does two things before switching `place_order` to FIFO:

1. Creates a **default "Main Warehouse"** if none exists.
2. **Backfills**: every variant with `stock > 0` and no batches gets an `INIT` lot
   (`mfg_date = today`, `qty = current stock`) in the default warehouse.

This is why the switch was seamless — the moment batches took over, every product already had a
lot equal to its previous stock, so nothing went out of stock. The backfill is idempotent
(`where not exists (...)`), so re-running is safe.

**Apply order:** `0007` schema → `0008` RLS/permissions → `0009` functions → `0010` backfill +
FIFO `place_order` → (`0015` security hardening).

---

## 11. Known limits / future work

- **Restock targets the newest lot**, not the original lot (see §5). Movement rows retain the
  truth if exact reversal is ever needed.
- **No expiry-blocking**: expired lots are highlighted in admin but `deduct_fifo` will still sell
  them (FIFO by `mfg_date`, not FEFO by expiry). If you want *First-Expired-First-Out* or a hard
  block on expired stock, that's a one-line change to the `order by` plus a `where` clause.
- **No per-warehouse allocation at checkout** — FIFO picks the oldest lot across all warehouses,
  regardless of location. Shipping isn't warehouse-aware yet.
- **No reorder levels / low-stock alerts per batch** (product-level low-stock exists).
- `cost_price` is captured but not yet used for margin reporting.
