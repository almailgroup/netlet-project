# Proposed migrations — website review, October 2026

**Not applied.** None of this is in `drizzle/`, so no test, bootstrap or deploy runs it. Each part
waits on the owner's approval. Once one is approved it becomes a numbered file in
`drizzle/`, `node scripts/build-bootstrap.mjs` regenerates `docs/supabase-bootstrap.sql`, and
the bootstrap file has to be **run again in the Supabase SQL editor** before the deploy that
needs it.

All three are additive: new nullable columns, a new table, a new enum value. Nothing existing
is renamed, dropped or rewritten, so each one is safe to run before the code that uses it ships.

Review item 13 (photo per colour) turned out **not** to need a migration. Choosing a variant
already shows the first photo whose description names its colour; the matching was fixed to
whole words (size "S" used to match any photo containing an "s"), and the editor now tells
sellers how it works. A column pinning a photo to a variant can come later if descriptions
prove too loose.

---

## A. Structured Kuwaiti address (review item 2)

**Why.** An address is one free-text `address_line` today. Drivers in Kuwait navigate by area,
block, street, avenue, house; a PACI number identifies the building exactly. Checkout and the
address book would ask for these as separate boxes, with the area chosen from a list for the
governorate (a list kept in `shared/`, not a table).

**Shape.** Columns on the address book, because a saved address is edited field by field. One
frozen document on the order, because an order is an obligation: it copies the address as it
was given and never reads the book again — the rule every other figure on an order follows.
`address_line` stays required and becomes the composed line (written from the parts on save),
so every page and every order placed before this keeps working unchanged.

```sql
-- 0057_structured_address.sql
ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "area" varchar(60);
ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "block" varchar(10);
ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "street" varchar(120);
ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "avenue" varchar(60);
ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "building" varchar(60);   -- house or building number
ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "floor" varchar(10);
ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "apartment" varchar(20);
ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "paci_number" varchar(12); -- PACI address number, digits only

-- The order's copy, frozen at the sale like its prices: { area, block, street, avenue, building, floor, apartment, paciNumber }.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_address_parts" jsonb;
```

**Not included:** placing the map pin from a PACI number. That needs PACI's (Kuwait Finder)
lookup service — a provider account, not a column. Until then the pin stays the shopper's own.

---

## B. Paid home-page banners (review item 20)

**Why.** The review asks for a banner carousel on the home page tied to Admin › Placements. A
placement today books a *product* into a shelf; a banner is a wide image and a headline a store
books for days, which the booking row has no room for.

**Shape.** A third slot on the existing booking, so a banner is charged, capped per day and
taken off the payout run exactly as placements are. The image is an ordinary upload
(`media_files`, JPEG or WebP, fixed on the way in). A banner is an advertisement NetLet shows on
its own front page, so it waits for an administrator before it runs — and one advertising a
saving still needs the store's discount permit, which the read checks as it does for every
offer.

```sql
-- 0058_home_banners.sql
-- A new enum value cannot be used in the transaction that adds it; the bootstrap
-- generator wraps this one in its own DO block for that reason.
ALTER TYPE "ad_slot" ADD VALUE IF NOT EXISTS 'home_banner';

ALTER TABLE "ad_bookings" ADD COLUMN IF NOT EXISTS "banner_media_id" varchar(64)
  REFERENCES "media_files"("id") ON DELETE SET NULL;
ALTER TABLE "ad_bookings" ADD COLUMN IF NOT EXISTS "banner_headline" varchar(80);
ALTER TABLE "ad_bookings" ADD COLUMN IF NOT EXISTS "banner_headline_ar" varchar(80);
-- pending → approved | rejected; only an approved banner is drawn.
ALTER TABLE "ad_bookings" ADD COLUMN IF NOT EXISTS "banner_status" varchar(12);
ALTER TABLE "ad_bookings" ADD COLUMN IF NOT EXISTS "banner_note" varchar(400);
ALTER TABLE "ad_bookings" ADD COLUMN IF NOT EXISTS "banner_reviewed_by" integer
  REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "ad_bookings" ADD COLUMN IF NOT EXISTS "banner_reviewed_at" timestamp with time zone;
```

**Design note.** The carousel would not move on its own — arrows and swipe only — for the
reason the header and the cards stopped moving: motion in the corner of the eye while somebody
reads. With no approved banner booked, nothing is drawn; there is no house banner pretending to
be one.

---

## C. Seller documents as real uploads (review item 28)

**Why.** `/sell` asks for links to documents hosted elsewhere (Drive, Dropbox), because there was
nowhere to put them. The review asks for real uploads — trade licence, signatory's civil ID, the
IBAN letter — each with its own review status.

**Why not `/media`.** Everything under `/media` is public under a random id and is JPEG or WebP
by design, so nothing there can be a page or a script. A civil ID must not be public at any
address, and a licence is usually a PDF. So these get their own table, served only to the
applicant and to administrators through an authenticated route, as an attachment
(`Content-Disposition: attachment`, `nosniff`, a sandboxing CSP), never inline.

**Checks.** Type read from the file's own first bytes (`%PDF-`, JPEG, PNG, WebP) and matched to
the declared type; at most 4 MB per file, because a Vercel function refuses a request body much
over 4.5 MB; at most one current file per kind, a replacement keeping the old one until the new
one is reviewed.

```sql
-- 0059_application_documents.sql
CREATE TABLE IF NOT EXISTS "application_documents" (
  "id" serial PRIMARY KEY,
  "application_id" integer NOT NULL REFERENCES "vendor_applications"("id") ON DELETE CASCADE,
  -- trade_licence | signatory_id | iban_letter | authorisation | other
  "kind" varchar(24) NOT NULL,
  "file_name" varchar(200) NOT NULL,
  "content_type" varchar(40) NOT NULL,
  "byte_size" integer NOT NULL,
  "sha256" char(64) NOT NULL,
  "bytes" bytea NOT NULL,
  -- pending | accepted | rejected, each decided by an administrator
  "status" varchar(12) NOT NULL DEFAULT 'pending',
  "review_note" varchar(400),
  "reviewed_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp with time zone,
  "uploaded_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "application_documents_application_idx"
  ON "application_documents" ("application_id", "kind", "created_at");
```

The existing `licence_doc_url` and `identity_doc_url` stay, so applications already submitted
with links keep them. **An alternative** to `bytea` is a private Supabase Storage bucket: the
database stays small, at the cost of a second service to configure and a signed-URL step. For
the volume of seller applications, Postgres is the simpler first step.
