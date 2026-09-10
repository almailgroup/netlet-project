# NetLet requirements — status against the codebase

Source: *Netlet — Requirements Document (Developer Version)*, 11 August 2026.

Every numbered item from that document appears below with an honest status.
Nothing is marked done that a shopper cannot use today.

| | meaning |
|---|---|
| **done** | built, tested, in `main` |
| **partial** | some of it works; the gap is named |
| **needs foundation** | cannot start until an architectural decision below is made |
| **not started** | buildable on today's code, nobody has |

---

## The decision this document was waiting on — resolved

This document describes **a multi-vendor marketplace**. What existed when it
was first read was **a single-vendor storefront**: one merchant's Shopify
catalog, with no concept of a vendor as a party to the transaction, no
per-vendor commission, and no admin surface.

**That fork has been taken: Shopify is gone and NetLet owns its catalog.**

What that unlocked, and where it landed:

- `drizzle/schema.ts` — vendors, vendor members, categories, products,
  variants, images, stock movements, carts.
- `shared/inventory/permissions.ts` — the access model. Scope (a vendor member
  reaches their own vendor, an admin reaches everything) and rank (`staff`
  moves stock, `manager` runs the catalog, `owner` runs the team). Commission
  is reachable by no vendor rank at all, which is what §3.3 asks for.
- `server/inventory.ts` — the data layer, with the guard next to each query
  rather than only at the router.
- `/dashboard` — one application for admins and vendors, scoped by the server.
- `server/catalog.ts` — the storefront reading those same tables, so a product
  added in the dashboard is a product in the shop.

Still greenfield, and still marked *needs foundation* below: payments and
payouts, the AI service layer (§3.5), affiliate marketing (§3.7), and
vendor–customer chat (§3.8).

---

## 3.1 Customer Experience

| # | Requirement | Status |
|---|---|---|
| 1 | Back-in-stock notification request, demand visible to vendor | **done** — follow a product, `followed_products`; demand shown as a count. Vendor-facing view needs §3.3 |
| 2 | Installation fees / extended warranty on eligible products | not started |
| 3 | Pre-order products | not started |
| 4 | Public + private wishlists, lookup by phone number | **partial** — saved items exist and sync to the account; public/shared lists and phone lookup not built |
| 5 | AI-personalised recommendations | needs foundation (AI layer) |
| 6 | AI visual search (photo or description) | needs foundation (AI layer) |
| 7 | Variants: colour swaps the photo, zoom, per-category attributes | **done** for colour swatches + photo swap + zoom. Per-category attribute config needs admin (§3.6) |
| 8 | AI virtual try-on | needs foundation (AI layer) |
| 9 | Product videos alongside photos | not started — `Product.images` has no video member yet |
| 10 | AI pulls manufacturer's official images | needs foundation (AI layer) |
| 11 | Quick View on listing pages | **done** |
| 12 | Icons alongside category names | **done** — department rail, artwork drawn from the catalog |
| 13 | "Request special discount", vendor-approved | needs foundation (vendor) |
| 14 | Referral system, two tracks, commission held past return window | needs foundation (vendor + payouts) |
| 15 | Referral points, spend or cash out at 10% fee | needs foundation (payments) |
| 16 | Reviews only after verified, delivered purchase | not started — ratings are displayed, no review system |
| 17 | Cart recovery reminder | **partial** — cart persists across sessions and devices; the reminder needs a scheduler + messaging |
| 18 | Price-drop alerts on a followed product | **done** — follow + `last_notified_price`. The sweep that sends them needs a scheduler |
| 19 | Subscribe & Save | not started |
| 20 | AI smart size guide | needs foundation (AI layer) |
| 21 | Frequently Bought Together | not started — `relatedProducts` is the nearest thing and is similarity, not affinity |

## 3.2 Checkout & Payments

| # | Requirement | Status |
|---|---|---|
| 22 | KNET, cards, Deema BNPL, payment link | **not started** — checkout is a mockup; `CHECKOUT_IS_MOCK_ONLY` is true and no payment is processed |
| 23 | Cash on delivery, admin-disableable | not started |
| 24 | Points, gift card, discount codes at checkout | not started |
| 25 | Multi-vendor cart, delivery cost per vendor | needs foundation (vendor) |
| 26 | Delivery speed per product | needs foundation |
| 27 | Delivery address per product | needs foundation |
| 28 | Address via interactive map | not started — governorate picker only |
| 29 | Split an order into per-product sub-operations | needs foundation (order service) |
| 30 | Fast checkout as top priority | **partial** — the cart and address are persisted; there is no checkout to be fast |

## 3.3 Vendor Experience

All fifteen items — self-registration, contracts, commission rates, bulk
upload, AI product review, trust badges, bundles, delivery provider choice,
featured placement booking, individual-seller path, violation suspension,
discount licences, automatic payouts, account health score — are **needs
foundation**. There is no vendor entity in the system.

## 3.4 Delivery

| # | Requirement | Status |
|---|---|---|
| 46 | Multiple delivery companies | needs foundation |
| 47 | Delivery company bears damage cost | needs foundation (policy + orders) |
| 48 | Real-time map tracking with live ETA | **partial** — `order_tracking_events` exists and the account page reads it; no courier feed, no map |
| 49 | Delivery rating separate from product rating | not started |

## 3.5 AI Customer Service

All three items — chat/WhatsApp/voice contact centre, automated
return/exchange handling, AI-generated tutorial videos — are **needs
foundation**. The only AI in the system today is Mistral-backed search
refinement (`server/routers/search.ts`).

## 3.6 Admin Panels

All six items — finance, product approval, audit trail, fraud detection,
e-invoicing — are **needs foundation**. There is no admin surface. The `users`
table has an `admin` role, and `/dashboard` is what reads it.

## 3.7 Affiliate Marketing · 3.8 Vendor-Customer Chat · 3.9 Grocery

**Needs foundation**, all three. §3.9 is explicitly "built now, used later";
the catalog model can now carry it — a grocery variant is a variant with a
weight or volume option — but nothing reads that yet.

## 4. Built now, activated later

Loyalty subscription, managed fulfilment, grocery — **needs foundation**.

---

## What a shopper can actually do today

Browse departments with filters, search, quick-view a product, pick a variant
and see it, follow a product for price and stock alerts, save items, keep a
cart across devices, and read it all in English or Arabic. They cannot buy
anything: there is no payment.
