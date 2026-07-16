# Suddhalaya — Inventory Runbook (Warehouse · Stock · Restock)

A step-by-step guide for whoever runs the store day-to-day. No engineering knowledge needed.

**Where everything lives:** Admin → **Inventory** tab.
Sign in at `/#/admin` with your staff account (roles that can touch stock: **Owner, Manager,
Fulfilment**).

> **The one rule to remember:** stock lives in **batches** (lots). The Stock number you see in
> lists is just a **running total of the batches** — the system keeps it in sync for you.
> To change stock, change a batch. See §7 for the trap this creates.

---

## 1. First-time setup — create your warehouses

You start with one auto-created **Main Warehouse (MAIN)**. Add more only if you physically store
goods in more than one place.

1. Admin → **Inventory**
2. Click **🏬 Warehouses** (top-right of the toolbar)
3. Click **＋ New warehouse**
4. Fill in:
   - **Name** — e.g. `North Hub`
   - **Code** — short, unique, e.g. `NORTH` *(can't be changed later)*
   - **City / State / PIN code / Address**
   - **Default warehouse** toggle — turn on for the location that should receive
     automatic restocks. **Only one warehouse can be the default**; turning it on here
     automatically turns it off elsewhere.
5. **Save warehouse**
6. **← Back to stock** to return to the inventory list

**To retire a warehouse:** click the **⊘** button. It's **deactivated**, not deleted — it
disappears from dropdowns but its history stays intact. (We never hard-delete a warehouse
because batches point at it.)

---

## 2. Receiving new stock from a supplier

This is the main day-to-day task.

1. Admin → **Inventory**
2. Find the product (use the search box) → click **📦** on its row
3. If the product has multiple sizes, pick the **variant** (e.g. `250 ml`) using the buttons at
   the top
4. Scroll to **Add to stock** and fill in:
   - **Batch / lot no.** — the lot number printed on the packaging, e.g. `B-2026-07`
   - **Warehouse** — where it's physically going
   - **Source** — leave as **Supplier receipt — new stock purchased**
   - **Mfg date** — ⚠️ **important**, this decides which stock sells first (see §3)
   - **Expiry date** — optional (staples like salt have none)
   - **Quantity** — how many units arrived
   - **Cost/unit ₹** — optional, for future margin reports
5. Click **Add to stock**

✅ The batch appears in the table and the product's **Stock** total updates automatically.

**Receiving more of a lot you already have?** Use the **same batch number + same warehouse** — it
**tops up** the existing lot rather than creating a duplicate.

---

## 3. How stock gets used when orders come in (FIFO)

You don't do anything here — it's automatic — but you should know the behaviour:

- When a customer orders, the system takes stock from the **oldest manufacture date first**
  (FIFO — First In, First Out).
- If the oldest lot can't cover the order, it **spills over** into the next-oldest, and so on.
- If there genuinely isn't enough stock across all lots, the order is **rejected** — nothing is
  half-deducted.

**Example**

| Lot | Mfg date | Before | After a 3-unit order |
|---|---|---|---|
| `OLD-01` | 01 Jan 2026 | 5 | **2** ← used first |
| `B-2026-07` | 10 Jul 2026 | 29 | 29 *(untouched)* |
| **Stock total** | | **34** | **31** |

⚠️ **This is FIFO by manufacture date, not by expiry.** If you ever receive a lot with an *older*
mfg date but a *longer* shelf life, it will still be sold first. Tell us if you'd rather sell
soonest-to-expire first (FEFO) — it's a small change.

---

## 4. Returns & restocking

### 4a. The normal way — it's automatic ✅
If you refund or cancel in the system, stock comes back **by itself**:

- **Cancelling an order:** Orders → open the order → change status to **cancelled** → stock returns.
- **A return/RMA:** Returns → **Approve** → **Refund** → stock returns and the order is marked
  refunded.

You do **not** need to touch Inventory for these.

### 4b. The manual way — goods back *without* a refund
Use this only when stock physically comes back but no refund/cancel happened in the system —
e.g. **courier RTO** (refused COD delivery), an exchange, or a supplier replacement.

1. Inventory → **📦** on the product → pick the variant
2. **Add to stock**:
   - **Batch / lot no.** — the lot printed on the returned pack (this is why the batch number
     matters — you can put it back in the *exact* lot it came from)
   - **Source** → **Customer return / RTO — goods coming back**
   - Mfg date, quantity
3. **Add to stock**

> 🚫 **Never do both.** If you already cancelled/refunded the order, the stock is **already back**.
> Adding it manually too will **double-count** your inventory.

---

## 5. Corrections (stock-take, damage, breakage)

### Found **fewer** than the system says (shrinkage/damage) → **Adjust**
1. Inventory → **📦** → find the lot → click **✎**
2. Enter the **actual remaining** count → OK

### Found **more** than the system says → **Add to stock**
1. Inventory → **📦** → **Add to stock**
2. **Source** → **Found in stock-take — correction**
3. Enter the lot, mfg date and the **extra** quantity → **Add to stock**

> Why two different places? **Adjust can only reduce** a lot (you can't have more left than ever
> arrived). Anything that *increases* stock goes through **Add to stock**, so the reason is
> recorded correctly.

---

## 6. Moving stock between warehouses

1. Inventory → **📦** on the product → pick the variant
2. Find the lot → click **⇄**
3. Enter the destination **warehouse code** (e.g. `NORTH`) → then the **quantity**

The units leave the source lot and appear as the same lot at the destination. Totals are
conserved, and both sides are logged (`transfer_out` / `transfer_in`).

*(Requires at least two active warehouses.)*

---

## 7. ⚠️ Gotchas — read this

**1. Don't type stock numbers directly.**
There are Stock boxes in the Inventory list and in the product **Edit** modal. Once a product has
batches, **those numbers are a total, not a setting** — anything you type there will be
**overwritten** the next time any batch for that product changes. Always change stock via
**📦 → Add to stock / Adjust**.

**2. Don't double-restock.** Refund/cancel already returns stock (§4a).

**3. Mfg date decides selling order** (§3). A typo here means the wrong lot ships first.

**4. Batch number + warehouse = the lot's identity.** Same number, same warehouse → tops up.
Same number, *different* warehouse → a separate lot (which is correct — it's in a different place).

**5. Expiry is a warning, not a block.** Expiring lots go **amber (≤30 days)** and expired go
**red** in the batch table, but they can still be sold. Watch the colours.

---

## 8. Where to see what happened

- **Batch table** (📦) — current lots: batch no, mfg, expiry, warehouse, received, left, with
  expiry colour-coding.
- **Every single movement is logged permanently** — receipts, sales, returns, transfers,
  adjustments, damage — with who did it, when, and the order number where relevant. Nothing can be
  quietly edited: it's an append-only record, so any stock number can always be explained.
- **Reports → Region-wise sales** for where product is actually going.

---

## 9. Quick reference

| I want to… | Go to | Source / action |
|---|---|---|
| Add a storage location | Inventory → 🏬 Warehouses → ＋ New | — |
| Book in a supplier delivery | Inventory → 📦 → Add to stock | **Supplier receipt** |
| Put back an RTO / exchange (no refund) | Inventory → 📦 → Add to stock | **Customer return / RTO** |
| Fix a count that's **too low** | Inventory → 📦 → Add to stock | **Found in stock-take** |
| Fix a count that's **too high** | Inventory → 📦 → **✎** on the lot | Adjust remaining |
| Move stock to another location | Inventory → 📦 → **⇄** on the lot | Transfer |
| Refund and return stock | Orders / Returns → Refund | *automatic* |
| See what's expiring | Inventory → 📦 | amber ≤30d, red = expired |
