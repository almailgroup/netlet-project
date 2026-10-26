# Schema changes for the remaining requirements

**Approved and applied, all eight parts, 26 October 2026**, with the answers marked
*proposed* below — the owner's word was "apply all of them with your suggestions". They
are migrations 0062–0069 (`Backend/database/`), carried by `docs/supabase-bootstrap.sql`
and checked by `docs/schema-audit.sql`. Written the same day, after the requirements audit
(`docs/REQUIREMENTS.md`) closed everything code alone could close; what is left there as
partial needs a provider (cards, WhatsApp, voice, the bank's API) or a lawyer.

**As built, where it differs from or adds to the text below:**

- **C.** A store's `delivery_mode` defaults to `netlet`, not `own`: every store dispatched
  through NetLet's board before, so that is what an unset store keeps doing. A member's
  free delivery waives the regular trip only — fast is a different trip the shopper chose
  to pay for and stays charged — and a fast parcel pays the fast fee whatever it holds;
  the free-over threshold is the regular trip's.
- **A.** The invite's percentage is read when the cash is collected, not frozen at the
  sale (the product link's is frozen on the line). Product links are kept in the browser
  for `PRODUCT_LINK_DAYS` (30) and sent with the order; the app shares product links with
  the shopper's code but does not record links arriving in it, having no web links into it.
- **B.** The store-funded share is carried inside the line's `commission_amount` (and out
  of its `vendor_net`), so every report that adds commission and net still adds up; a
  referral's percentage is taken of NetLet's own share, the commission less that pass-through.
- **G.** While a return is in `review`, the seller's proposal is the row's `decline_reason`
  (null proposes approving) and their words are `vendor_response`; NetLet's confirmation
  keeps the reason when it agrees, and is audited as `return.confirm`.
- **F.** The overall is the three parts' average rounded half up, and is what `rating`
  holds, so every score that read one figure still does.

Every statement is additive except part H, which drops the two messaging tables the owner
asked to remove. New columns are nullable or carry a default, so each part is safe to run
before the code that uses it ships, and `docs/supabase-bootstrap.sql` would carry them the
usual way (run it again, look for its "bootstrap complete" row).

Where the document leaves a business choice open, the part ends with **a question**; the
SQL below is written for the answer marked *proposed*, and changes if the answer differs.

---

## A. Referral: a product-link track, an ongoing invite commission, paid after the return window (3.1.14, 3.1.15)

**The document.** "Referral system with two tracks: (a) a specific product link — the
commission applies only to that product; (b) a general invite — any first purchase by the
invitee grants the referrer an ongoing commission. Referral commissions are only paid out
after the legal return period has passed." And "a set percentage (admin-configurable) for
the product-link referral commission, credited as points".

**Today.** One track: a fixed 500 points to the inviter and 250 to the friend on the
friend's first paid order, credited the moment the cash is collected.

**Shape.**
- *Product link*: any shopper's link to a product (`/products/x?ref=CODE`, the code every
  account already has). An order line for that product bought through the link freezes
  who shared it and the rate, like an order freezes its affiliate. The sharer earns that
  percentage of the line as points.
- *General invite*: the invite stays one row per invited account; from their first paid
  order the inviter earns a percentage of **each** order the invitee places, for as long
  as the programme runs — the "ongoing commission".
- *Held until the return window passes*: a commission is written when the cash is
  collected, with the day it becomes spendable; the balance counts only what has
  matured, and a line returned before then takes its share back before anybody could
  spend it.
- *Admin-set percentages*: a small settings table, because there is nowhere today for a
  number an administrator changes without a deploy. The same table can carry other
  numbers later.

```sql
-- 0062_referral_tracks.sql
-- Numbers an administrator sets without a deploy (the feature switches' sibling).
CREATE TABLE IF NOT EXISTS "platform_settings" (
  "key"        varchar(64) PRIMARY KEY,
  "value"      varchar(200) NOT NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
-- e.g. ('referral.productPercent', '2.00'), ('referral.invitePercent', '1.00')

-- The product link's sharer and rate, frozen on the line like the affiliate's.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "referrer_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "referral_rate" numeric(5,2);

-- A commission is credited at once and spendable from this moment (the end of the
-- return window); null is spendable now, which is every row written before this.
ALTER TABLE "point_entries" ADD COLUMN IF NOT EXISTS "available_at" timestamptz;

-- A line earns its product-link commission once, and is taken back once.
CREATE UNIQUE INDEX IF NOT EXISTS "point_entries_product_referral_unique"
  ON "point_entries" ("order_item_id") WHERE "reason" = 'product_referral';
CREATE UNIQUE INDEX IF NOT EXISTS "point_entries_invite_commission_unique"
  ON "point_entries" ("order_item_id") WHERE "reason" = 'invite_commission';
```

**Questions.**
1. Keep the fixed 500 / 250 welcome on the first order beside the new ongoing commission,
   or replace it? *Proposed: keep it* — it is what tells the friend the link was worth
   using.
2. Is the commission a percentage of the **line's price** or of **NetLet's commission** on
   it? *Proposed: of NetLet's commission*, capped by it, like affiliates — so a referral
   can never cost more than NetLet earned, and the seller's net is never touched.
3. Starting percentages? *Proposed: 20% of NetLet's commission for a product link, 10% for
   an invitee's orders.*

---

## B. Affiliates: sellers choose which products, and fund the extra commission (3.7.1)

**The document.** "Lets vendors choose/opt in specific products of their own to
participate in … affiliate marketers … promote/sell them via their own link, in exchange
for an additional commission when a sale is completed."

**Today.** Every product earns an affiliate commission, paid out of NetLet's cut, and no
seller is asked.

**Shape.** A product takes part only when its store ticks it, at a rate the store sets;
the rate is frozen on the line at the sale and comes out of the seller's net on that line,
because it is the seller's own marketing. Affiliates browse a list of the products open to
them, with each one's rate.

```sql
-- 0063_affiliate_opt_in.sql
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "affiliate_percent" numeric(5,2);   -- null = not offered to affiliates
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "affiliate_vendor_percent" numeric(5,2); -- frozen at the sale
CREATE INDEX IF NOT EXISTS "products_affiliate_idx" ON "products" ("affiliate_percent") WHERE "affiliate_percent" IS NOT NULL;
```

**Question.** Who pays the affiliate? *Proposed: the seller, at the rate they set, for the
products they opt in; NetLet's own share stops.* The alternative — NetLet's share on every
product plus the seller's extra on opted-in ones — needs no further column but keeps
NetLet paying for links on products nobody chose.

---

## C. Delivery: the shopper picks fast or regular per product; the store picks its own company or NetLet's (3.2.5, 3.3.13)

**The document.** "Choice of delivery speed (fast/regular) per individual product within
the same order." And "per-vendor choice of delivery provider: their own delivery company
or the platform's own delivery service, configurable from the system."

**Today.** The speed is a band each seller states; nothing is chosen at checkout and fast
has no price. A store's carrier is a name it types, which the dispatch board never reads.

**Shape.**
- A store that offers fast delivery records its fee and the band it promises; a line in
  the bag carries the shopper's choice (regular unless changed), and the order freezes it.
  Fast and regular lines from one store to one door are two parcels, because they leave
  at different times; each parcel is charged its own fee.
- A store chooses **its own company** or **NetLet's service**. NetLet's: its parcels go on
  NetLet's dispatch board to be given to a delivery company. Its own: when that company is
  on NetLet, its parcels go straight to that company's board; when it is not, the store
  marks them shipped itself, as today.

```sql
-- 0064_delivery_choices.sql
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "fast_delivery_fee"   numeric(12,3);  -- null = no fast option
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "fast_delivery_speed" varchar(20);    -- the band fast promises, e.g. same_day
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "delivery_mode" varchar(10) NOT NULL DEFAULT 'own'; -- 'own' | 'netlet'
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "delivery_courier_id" integer REFERENCES "couriers"("id") ON DELETE SET NULL;

ALTER TABLE "cart_items"  ADD COLUMN IF NOT EXISTS "delivery_choice" varchar(8) NOT NULL DEFAULT 'regular'; -- 'regular' | 'fast'
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "delivery_choice" varchar(8) NOT NULL DEFAULT 'regular';
```

**Question.** Who keeps a fast-delivery fee? *Proposed: the same as the regular fee*, which
`docs/REQUIREMENTS.md` already notes nobody has decided — the order records it per store
either way.

---

## D. Commission: proposals for a fixed amount or one product, and one employee allowed to set it (3.3.2, 3.3.9)

**The document.** "The option to propose a custom rate or fixed amount for specific
products, subject to later admin approval (included in the contract if approved)." And
commission edited "only by the admin, or by an employee specifically authorized to do so
… and which admin granted that employee this specific permission."

**Today.** An applicant may propose a lower percentage for the whole store, nothing else.
Only a full administrator can change a commission.

**Shape.**
- A proposal is a row: for the whole store or one product, a percentage or a fixed amount,
  with a reason; an administrator accepts (which sets the rate, audited with the chain) or
  declines with a note. An applicant proposes from `/sell`; a store proposes from a
  product's page in the portal. One open proposal per store and product.
- A grant is a row: this account may do this one thing, granted by this administrator.
  The commission desk opens to an account holding `vendor.setCommission`, and the audit
  row names the grant's administrator — the "which admin granted" the document asks for.

```sql
-- 0065_commission_controls.sql
ALTER TABLE "vendor_applications" ADD COLUMN IF NOT EXISTS "proposed_commission_fixed" numeric(12,3);

CREATE TABLE IF NOT EXISTS "commission_proposals" (
  "id"            serial PRIMARY KEY,
  "vendor_id"     integer NOT NULL REFERENCES "vendors"("id") ON DELETE CASCADE,
  "product_id"    integer REFERENCES "products"("id") ON DELETE CASCADE,  -- null = the whole store
  "percent"       numeric(5,2),
  "fixed"         numeric(12,3),
  "reason"        varchar(500),
  "status"        varchar(12) NOT NULL DEFAULT 'pending',              -- pending | accepted | declined | withdrawn
  "decision_note" varchar(400),
  "created_by"    integer REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_by"    integer REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at"    timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "commission_proposals_one_figure" CHECK (("percent" IS NULL) <> ("fixed" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "commission_proposals_open_unique"
  ON "commission_proposals" ("vendor_id", COALESCE("product_id", 0)) WHERE "status" = 'pending';

CREATE TABLE IF NOT EXISTS "staff_grants" (
  "user_id"    integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "capability" varchar(48) NOT NULL,                                     -- 'vendor.setCommission' for now
  "granted_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "capability")
);
```

**Also needed, with no migration:** the contract step of 3.3.1 — NetLet attaching the final
contract to an application and the applicant uploading it signed — fits the existing
`application_documents` (its kind is text), so it is built with this part.

---

## E. Three warnings, not three rejections (3.3.18)

**The document.** "Automatic suspension of a vendor's account after 3 violation warnings."

**Today.** The third product rejection in a store's life suspends it: a missing photo
counts like a counterfeit, nobody is told they are at two, the count never expires, and a
reinstated store is suspended again by its next rejection.

**Shape.** A warning is something an administrator issues on purpose, with a reason the
seller reads (optionally naming a product), and it is told to the store's people at once.
The third warning still standing suspends the store. A warning lapses after a year; one
can be withdrawn; reinstating a store starts its count again.

```sql
-- 0066_vendor_warnings.sql
CREATE TABLE IF NOT EXISTS "vendor_warnings" (
  "id"          serial PRIMARY KEY,
  "vendor_id"   integer NOT NULL REFERENCES "vendors"("id") ON DELETE CASCADE,
  "product_id"  integer REFERENCES "products"("id") ON DELETE SET NULL,
  "reason"      varchar(400) NOT NULL,
  "issued_by"   integer REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at"  timestamptz NOT NULL,
  "withdrawn_at" timestamptz,
  "withdrawn_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "vendor_warnings_vendor_idx" ON "vendor_warnings" ("vendor_id", "created_at");

-- Warnings before this moment no longer count (set when a store is reinstated).
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "warnings_since" timestamptz;
```

**Question.** How long does a warning stand? *Proposed: 365 days.*

---

## F. Delivery rated three ways (3.4.4)

**The document.** "A delivery rating separate from the product rating (speed, package
condition, courier conduct)."

**Today.** One set of stars and a comment per parcel.

**Shape.** Three stars each, and the overall figure is their average, so every report that
reads `rating` today goes on working; ratings given before keep their one figure.

```sql
-- 0067_delivery_rating_parts.sql
ALTER TABLE "delivery_ratings" ADD COLUMN IF NOT EXISTS "speed"     smallint;
ALTER TABLE "delivery_ratings" ADD COLUMN IF NOT EXISTS "condition" smallint;
ALTER TABLE "delivery_ratings" ADD COLUMN IF NOT EXISTS "conduct"   smallint;
ALTER TABLE "delivery_ratings" DROP CONSTRAINT IF EXISTS "delivery_ratings_parts_range";
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_parts_range" CHECK (
  ("speed" IS NULL OR "speed" BETWEEN 1 AND 5) AND
  ("condition" IS NULL OR "condition" BETWEEN 1 AND 5) AND
  ("conduct" IS NULL OR "conduct" BETWEEN 1 AND 5));
```

---

## G. Returns: read the shopper's words, hear the seller, an administrator confirms (3.5.2)

**The document.** "Automatic handling of return/exchange requests: understanding the issue,
communicating with the vendor to resolve it, then replying to the customer — requiring only
a final confirmation from the admin."

**Today.** Rules decide from the reason chosen (a fault is approved, a change of mind
approved except on groceries), "other" goes to the seller, and no administrator confirms.

**Shape.** The model reads the shopper's note (fenced as data) and writes a short summary
and a suggested outcome; the seller is asked and may answer; an administrator confirms the
outcome, and only then is the shopper told. The model suggests and never decides — the
rule this shop applies to every model call.

```sql
-- 0068_return_confirmation.sql
ALTER TABLE "return_requests" ADD COLUMN IF NOT EXISTS "ai_summary"          varchar(600);
ALTER TABLE "return_requests" ADD COLUMN IF NOT EXISTS "ai_suggestion"       varchar(12);  -- approve | decline | exchange
ALTER TABLE "return_requests" ADD COLUMN IF NOT EXISTS "vendor_response"     varchar(400);
ALTER TABLE "return_requests" ADD COLUMN IF NOT EXISTS "vendor_responded_at" timestamptz;
ALTER TABLE "return_requests" ADD COLUMN IF NOT EXISTS "confirmed_by"        integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "return_requests" ADD COLUMN IF NOT EXISTS "confirmed_at"        timestamptz;
```

**Question.** Does a return the rules already decide (a damaged item, inside the window)
also wait for an administrator? *Proposed: no* — Kuwaiti consumer protection does not let
the shop refuse it, so waiting only delays the shopper's money; the administrator confirms
the ones the rules cannot decide ("other", and anything the seller disputes).

---

## H. Remove the shopper–store messaging tables (3.8, on the owner's word)

**Why.** The messaging was removed from the code on the owner's word; the two tables and
the notices it wrote are left in the database, unread. This drops them.

**This is the one destructive part**: every message ever exchanged between shoppers and
stores is deleted. Export them first if a record is wanted (a `pg_dump` of the two tables).

```sql
-- 0069_drop_seller_messages.sql
DELETE FROM "notifications" WHERE "kind" IN ('seller_message', 'seller_shopper_message');
DROP TABLE IF EXISTS "conversation_messages";
DROP TABLE IF EXISTS "conversations";
```

---

## What stays outside these

- **Card payments, BNPL and payment links (3.2.1)**, and what waits on them: buying a
  membership (4.1) and paying sellers by card in one to three days (3.3.21). A provider.
- **WhatsApp and voice (3.5.1).** A WhatsApp Business account and a telephony provider.
- **Automatic bank transfers (3.3.21).** The bank's own API; today it is one file uploaded.
- **E-invoices against the decree (3.6.6).** Somebody qualified reading the decree beside
  the invoice.
- **Microservices (2.1).** An architecture decision, not a migration.
