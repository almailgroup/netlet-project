# NetLet requirements, against the code

Every requirement in *Netlet — Requirements Document (Developer Version)*
(version 11 August 2026), mapped to what is actually in this repository.

Status is deliberately harsh. **Built** means it works end to end against a
real database and a real server. **Partial** names the gap rather than
rounding up. Nothing is marked done because the schema could support it.

| | count |
|---|---|
| Built | 12 |
| Partial | 12 |
| Designed, not wired | 1 |
| Not started | 52 |

---

## 2. Architectural principles

| # | Requirement | Status | Where it stands |
|---|---|---|---|
| 2.1 | Fully microservices-based | **Not started** | One Express + tRPC app, one Postgres, one Vercel function. The seams are clean — each `server/` module has 1–4 relative imports and **no cross-module transactions** — so splitting later is packaging, not a rewrite. See the note at the foot of this file. |
| 2.2 | Easy for all five parties | **Partial** | Buyer, vendor and admin each have a real interface. **The delivery company and the order-processing employee have no interface at all** — two of the five audiences are absent, not merely rough. |
| 2.3 | Every advanced feature optional | **Partial** | The habit exists: `autoPublish` per vendor, Firebase-or-scrypt chosen by config, `SEARCH_MODES_WIRED`, and nothing throws at boot so a missing value is a dead feature rather than an outage. There is no feature-flag system as such, and no per-vendor or per-tenant switchboard. |
| 2.4 | AI core, not an afterthought | **Partial** | Two real uses: the recommendation rail (`server/recommendations.ts`) and `search.refine`. Both carry the guardrails worth keeping — a model reorders but never chooses, only interest terms leave NetLet, every failure falls back to a deterministic answer. Customer service, product management, imaging and fraud are all absent. |

## 3.1 Customer experience — 5 built, 1 partial, 1 drawn, 14 absent

| # | Requirement | Status | Where it stands |
|---|---|---|---|
| 1 | Back-in-stock request, vendor sees demand | **Built** | `followed_products`; `customer.follows.demand` is public so the "N people are waiting" line can render. Vendor-side surfacing needs a panel. |
| 2 | Optional installation fees, extended warranty | Not started | |
| 3 | Pre-order | Not started | |
| 4 | Public/private wishlists, found by phone | **Built** | `wishlists`, `wishlist_items`, phone key, claim holds, lookup throttle. |
| 5 | AI personalised recommendations | **Built** | `shared/commerce/taste.ts` + model reorder pass. |
| 6 | AI visual search (photo or description) | **Drawn, not wired** | `SearchModes.tsx` has every state designed. `SEARCH_MODES_WIRED` governs one line of copy; nothing is listening. |
| 7 | Variants: colour swaps photo, zoom, per-category attributes | **Partial** | Swatches and zoom are built. Attributes are free-form `jsonb` — there is no per-category attribute schema. |
| 8 | AI virtual try-on | Not started | |
| 9 | Product videos | Not started | No video anywhere in the schema or the client. |
| 10 | AI pulls manufacturer images | Not started | There is no image pipeline at all — vendors type URLs. |
| 11 | Quick View with quantity | **Built** | On every page that draws a card. |
| 12 | Category icons | Not started | Departments carry a colour each, no icon. |
| 13 | Request a special discount (vendor opt-in) | Not started | |
| 14 | Referral, two tracks | Not started | |
| 15 | Referral points, spend or cash out at 10% | Not started | No points ledger. |
| 16 | Reviews: verified purchase, after delivery | Not started | **No reviews table.** Today's star rating is a merchant-typed attribute. |
| 17 | Cart recovery reminder | Not started | |
| 18 | Price-drop alerts | **Built** | Same follow mechanism. |
| 19 | Subscribe & Save | Not started | |
| 20 | AI size guide | Not started | |
| 21 | Frequently bought together, cross-vendor | Not started | |

## 3.2 Checkout & payments — 0 built, 3 partial, 6 absent

| # | Requirement | Status | Where it stands |
|---|---|---|---|
| 1 | KNET, cards, Deema BNPL, payment link | **Not started — blocked** | No provider touched. Needs a merchant account: 4–12 week lead time. |
| 2 | COD by default, disableable | Not started | |
| 3 | Points, gift card, discount codes | Not started | |
| 4 | Multi-vendor cart, delivery cost per vendor | **Partial** | `sliceByVendor` groups an order by vendor already. No delivery cost anywhere. |
| 5 | Delivery speed per product | Not started | |
| 6 | Different address per product | Not started | |
| 7 | Map address picker | Not started | Governorate select only. |
| 8 | Split an order into per-product operations | **Partial** | Fulfilment already lives on the *line*, not the order, which is the hard half. Return and re-pickup as operations are absent. |
| 9 | Fast checkout | **Partial** | The page exists; there is nothing to pay with. |

## 3.3 Vendor experience — 5 built, 3 partial, 14 absent

| # | Requirement | Status | Where it stands |
|---|---|---|---|
| 1 | Self-registration: account → choose vendor → documents → contract → approval | **Not started** | Today an admin creates the vendor and its login. There is no self-serve path, no document upload, no contract step. |
| 2 | Default commission shown at onboarding, propose custom | **Partial** | Commission is fully modelled; there is no onboarding to show it in. |
| 3 | Bulk upload by Excel, AI-assisted entry | Not started | |
| 4 | AI fixes images after upload | Not started | No upload exists. |
| 5 | AI auto-categorises on bulk upload | Not started | |
| 6 | AI reviews products, alerts admin | Not started | The review queue is entirely human. |
| 7 | Trusted companies publish directly | **Built** | `autoPublish`. |
| 8 | Vendor product changes visible to admin | **Partial** | Logged — `product.priceChange`, `product.create`, `product.delete`. Not notified. |
| 9 | Commission admin-only, log who changed it and who authorised them | **Partial** | Outside every vendor rank ✓, `vendor.setCommission` logs the actor ✓. Which admin granted that employee the permission is not recorded. |
| 10 | Vendor trust badges | **Built** | |
| 11 | Bundles, including cross-vendor | Not started | |
| 12 | Commission: % or fixed, per vendor or per product | **Built** | Explicit zero is an override; absent is not. |
| 13 | Per-vendor delivery provider | Not started | |
| 14 | Size/type → required vehicle type | Not started | |
| 15 | Self-service featured placement and ad booking | Not started | |
| 16 | Individuals selling under NetLet's licence, weekly payout report | Not started | |
| 17 | Switch between vendor and customer mode | Not started | One account holds both roles; there is no switch. |
| 18 | Auto-suspend after 3 warnings | **Built** | `violationCount` is read in `inventory.ts` and suspends. |
| 19 | Discount licence required on an offer (Kuwait law) | Not started | |
| 20 | Vendors who join discounts get better placement | Not started | |
| 21 | Auto payouts: COD 14 business days, others 1–3 | Not started | |
| 22 | Account Health Score | **Built** | Four evenly weighted components, each carrying its raw counts. |

## 3.4 Delivery — 0 of 4

Multiple delivery companies · damage borne by the carrier · live map tracking
with a moving ETA · delivery rating separate from the product rating.

`order_tracking_events` exists and is vestigial — the account page reads its
row count and nothing else. **This section and the two missing audiences in
2.2 are the same hole.**

## 3.5 AI customer service — 0 of 3

Chat + WhatsApp + voice contact centre (**named a Phase 1 top priority**) ·
automatic return/exchange handling · AI-generated tutorial videos.

## 3.6 Admin panels — 1 built, 1 partial, 3 absent

| # | Requirement | Status | Where it stands |
|---|---|---|---|
| 1 | Finance panel | Not started | Commission is calculated and frozen per order line; nothing reports on it. |
| 2 | Product approval panel, AI-backed | **Partial** | `/admin/review` is built and paged. The AI alerts are absent. |
| 3 | Automatic audit trail | **Built** | 14 actions, covering commission edits, approvals, permission changes and admin sign-ins. |
| 4 | No HR panel | n/a | Correctly absent. |
| 5 | AI fraud detection | Not started | |
| 6 | E-invoice compliance | Not started | |

## 3.7 Affiliate marketing · 3.8 Vendor–customer chat · 3.9 Grocery

All absent. Three notes worth keeping:

- **3.8's hard part is the filter, not the chat.** Blocking phone numbers,
  emails and handles — including the ways people spell them to get around a
  filter — is the requirement. A chat without it leaks every customer off the
  platform on day one.
- **3.9 needs a unit on the variant.** Sold-by-weight is a schema change
  (`unit`, `step`, price-per-unit), not a page. Cheap now, expensive later.
- **3.7 shares a ledger with 3.1's referral points.** Build one points ledger,
  not two.

## 4. Built now, activated later — 0 of 3

Kuwait loyalty subscription · fully-managed fulfilment (Shiplee) · grocery.

---

## The one recommendation I would put in front of the plan

**Stay a modular monolith until payments and fulfilment are real, then split.**

The goal in 2.1 is that a new feature ships without disturbing the rest of the
system. That goal is met today by the module boundaries, not by the network:
`shared/` is pure and holds every rule that costs money or access, guards sit
next to the queries they protect, and no transaction spans two modules. Those
are the properties that make a split cheap — and they are exactly the
properties a premature split destroys, because once `orders` and `inventory`
are two services, taking stock during checkout stops being a transaction and
becomes a saga with compensating writes.

The cost of waiting is low: the seams are measured above and they hold. The
cost of splitting now is paid on every feature in this document, before a
single dinar has been taken.

If the answer is still "split now", say so and I will — the document wins over
my recommendation. But I would want the payment and delivery services carved
out **first**, since those are the two with genuinely independent failure
modes and genuinely different scaling, and the rest to follow only when
something forces it.
