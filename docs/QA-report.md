# Suddhalaya — Full QA Report

**Build under test:** Next.js storefront + admin (single-file engine, `public/sudhalaya.js`) on live Supabase backend — production build (`next build` / `next start`).
**Scope:** Entire website — every storefront page & flow and every admin module, desktop + mobile, plus live-backend end-to-end and performance.
**Environments:** Desktop 1280px · iPhone SE 320px · iPhone 12 390px · Storefront + Admin.
**Method:** Automated Playwright sweeps (78 assertions) + live-backend API E2E (Razorpay, SMTP, reviews, orders, CMS) + performance measurement + manual visual review.
**Latest re-test:** full regression after the latest change batch — search placeholder, footer clean-up (X + COD badge), category tiles, mobile logo, and the new **review-delete** control (see §9).

## Result: ✅ 78/78 automated checks pass · 4/4 backend E2E pass · 0 console errors · **1 configuration finding** (COD disabled — see §5)

---

## 1. Storefront — Desktop + Mobile (22/22)

- Home: no overflow, header/hero/**featured products + "Shop All" button**, announcement bar reflects CMS, header nav correct (no "Our Story", Shop/About present), wishlist hidden for guests, removed items (subscription/banner/Taste button/guest hearts) confirmed gone.
- **Multi-page routing:** Shop is its own page (grid + filters), About is its own isolated page, Home returns correctly; filter chips work.
- PDP opens with Amazon button + breadcrumb; **variant switch updates the per-size Amazon link**.
- Cart: GST-inclusive summary (no separate GST line), checkout CTA present.
- Checkout: auth banner for guests, **State field + pincode→city/state autofill**.
- **Mobile 320 & 390:** zero horizontal overflow across home/shop/pdp/cart; burger on-screen; mobile nav → About works and auto-closes.

## 2. Account · Wishlist · Addresses · Orders (all pass)

- Account opens as its **own page** (not a modal); signed-in view shows name/orders/sign-out; **page scrolls correctly** (prior loop bug fixed).
- **Wishlist** appears only when signed in (icon + card hearts), badge updates, per-user.
- **Multiple saved addresses:** add (with pincode autofill) and remove — verified 2 addresses added, 1 removed.
- **Order placement** (COD, when enabled): places, confirms, persists to DB with correct method/status — verified end-to-end, test data cleaned up.

## 3. Admin — Desktop + Mobile (19/19, real owner login)

- Dashboard renders cleanly — **no storefront dock/cookie-banner leak**, KPI tiles even (no overflow), clickable tiles.
- Inventory: renders real data, action buttons fire, **table scrolls horizontally on mobile**.
- Category editor: name + slug + SEO all editable.
- Settings: editable contact/social + SMTP test button + COD toggle.
- CMS form (announcement/hero/story) + **review-moderation** panel present, now with a **Published-reviews list + Delete control** (see §9).
- Orders module loads real data. **Zero console errors** on every admin screen.

## 4. Live-backend E2E

| Flow | Result |
|---|---|
| **Razorpay** pay → verify → place | ✅ order created + real txn recorded; tampered signature rejected |
| **SMTP** connection + test email | ✅ delivered |
| **Review moderation** submit → held → approve → visible | ✅ PASS (with cleanup) |
| **CMS** admin edit → storefront reflects (+ live update) | ✅ PASS |
| **Order** checkout → DB persistence | ✅ PASS (COD, when enabled) |

## 5. ⚠️ Finding — Cash on Delivery is currently OFF (configuration, not a bug)

COD checkout **works correctly**, but it is **disabled in the store settings** (`app_config.settings.codEnabled = false`). With COD off, the `place_order` service correctly returns *"Cash on Delivery is not available for this order,"* so shoppers can only pay prepaid (Razorpay).

- **Verified:** with COD enabled, a guest COD order placed, confirmed, and persisted (`payment_method=cod`, `payment-pending`) — then the setting was **restored to its original value** and the test order deleted.
- **Action for client:** if COD should be available, enable it in **Admin → Settings → Cash on Delivery** (persists to config; the checkout honors it immediately). If prepaid-only is intended, no action needed.

## 6. Performance — blank-screen issue fixed

Measured before/after:

| | Before | After |
|---|---|---|
| First on-screen (fast net) | 2.2 s blank | **~0.05 s** (branded splash) |
| First on-screen (slow net) | 12 s blank | **~0.25 s** |
| Full storefront rendered (fast) | 2.2 s | **~0.7 s** |

Fixes: render-before-hydrate (removed the API wait from first paint), instant branded loading splash, Supabase preconnect — on top of the earlier 95% payload cut (5.7 MB → 277 KB, images on CDN).

## 7. Edge cases (9/9)

Deep-links `/#/shop` `/#/about` `/#/account`, product search, out-of-stock rendering, PDP variant Amazon-link switching, back-to-top on scroll — all pass, zero errors.

## 8. Notes

- **Green footer** is currently applied (a client-requested preview); revert on request (one CSS block, clearly marked in `globals.css`).
- **EKART** courier integration remains pending the courier's API details.
- Migrations `0018` + `0019` + `0020` applied and re-verified against the live DB.

## 9. Latest change batch — re-tested (19/19)

Every item from the most recent client feedback round, verified in the same automated sweep:

| Change | Verified |
|---|---|
| **Search placeholder** simplified to just "Search…" | ✅ no "ghee, honey, oils" |
| **Footer X (Twitter) icon** removed | ✅ gone; Facebook / Instagram / LinkedIn remain |
| **Footer COD badge** removed | ✅ gone; VISA / Mastercard / RuPay / UPI remain |
| **Category tiles** on mobile | ✅ 2-up small boxes (135px @ 320, 170px @ 390) — no longer one full-width banner |
| **Footer logo** on mobile | ✅ capped at 84px (was ballooning to full width) |
| **Notify-Me** on out-of-stock items | ✅ active button → modal → email capture; **backend now live** (`0020` applied, API returns `ok`) |
| **Review delete** (new) | ✅ Admin → CMS → Review moderation now lists **Published reviews** with a **Delete** button (staff-only, removes from storefront immediately); verified 3 live reviews → 3 Delete controls |

**Notify-Me → back-in-stock flow (now fully live):** shopper on an out-of-stock product taps **🔔 Notify Me** → enters email (pre-filled if signed in) → saved to the `stock_notifications` waitlist. When staff **Receive** stock (Inventory), the system emails everyone waiting via SMTP and clears them. Login is not required — the shopper's own email is the delivery address.

**Cleanup:** the only data any test created was one waitlist row (a test email), which was deleted after the run. No test orders or accounts left behind.
