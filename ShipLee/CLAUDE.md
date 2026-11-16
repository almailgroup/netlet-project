# ShipLee

A parcel-tracking website for a delivery company, at **shiplee.delivery**. A
customer types a tracking number and sees where the parcel is; ShipLee's staff
create shipments and add each update at `/staff`. React + Vite on the client,
one Vercel function for the API, Postgres for the shipments. English and
Arabic. `README.md` has the setup and the layout.

**It is a guest in NetLet's repository, not part of NetLet.** It has its own
`package.json`, lockfile, TypeScript, tests, Vercel project and database, and
imports nothing from NetLet; NetLet's checks do not read this folder (its
`tsconfig.json` and `vitest.config.ts` name their own folders) and this
folder's do not read NetLet's. It was built on the owner's word ("build this
project in the same repository as NetLet, just create a folder and call it
ShipLee … the design can be the same as NetLet but use white and pine green").
NetLet's rules about pushing straight to `main` hold here too.

## Design

**NetLet's design language in white and pine green, kept simple.** One family
(Inter, with IBM Plex Sans Arabic for the Arabic page, both served from the
site itself), white cards with a hairline on a pale ground, soft corners,
labels above boxes, problems under them. One bold thing — the pine band on the
home page with a dotted route drawn across it — and quiet everywhere else.

**Every colour is a token at the top of `src/styles.css` and nowhere else**,
because the owner said the colours may change. Each pairing was measured:
pine `#0d5c4a` on white and white on pine 7.9:1, the muted ink 6.1:1, a field's
border 3.7:1, the warning and refusal inks over 7:1 on their fills. A new
palette is that block alone; measure it the same way.

**A status is never colour alone**: every status carries its icon and its
name, and the progress line says to a screen reader whether each step is done,
current or to come.

**Arabic**: `<html lang dir>` is set before the first paint (a layout effect),
the stylesheet uses logical properties only, arrows that mean "back" flip,
and text a person typed (`dir="auto"`) keeps its own direction while lining up
with the page (`text-align: match-parent`). **A line built from parts isolates
the typed part** (`Destination`: an English area beside an Arabic governorate
read "Salmiya ،حولي" until the area was a `<bdi>`). Digits are Latin on both
pages, NetLet's rule.

## Tracking numbers

**"SL" and ten digits, the last a Luhn check digit** (`shared/tracking.ts`). It
catches every single wrong digit and every swap of two neighbours (but 09/90),
so the page says "that number doesn't look right" before asking the server,
rather than "not found", which reads as "your parcel is lost". Typed input is
read generously: case, spaces, dashes, a missing "SL" and Arabic-Indic digits
are all fine. Nine random digits are a billion numbers, drawn with
`crypto.randomInt`; a clash is drawn again.

## What the public sees

**The tracking page shows nothing about the recipient.** `publicView` is the
whole rule: the sender's name, the area and governorate, the pieces, the cash
to collect, the expected day and the updates — never the recipient's name,
phone or street, which only the staff desk reads. A test reads the public
answer's keys and fails on any other.

**A day already past is not shown as the expected day**, and a final status
(delivered, returned, cancelled) shows none: a promise that has lapsed is no
promise. A status's history decides how far the progress line is filled, not
its latest status alone — a parcel on hold after leaving with a driver has
still been out for delivery.

**Every date is Kuwait's** (UTC+3, no summer time), whoever is reading, and
updates are grouped under Today, Yesterday or the date.

## The staff desk

**One shared password** (`STAFF_PASSWORD`, at least 12 characters) and a
session cookie this server signs (HMAC, `SameSite=Strict`, `HttpOnly`, 12
hours), keyed by the password, so changing it signs every device out. Ten
wrong passwords from one address in fifteen minutes and that address waits —
counted in the database, since a function's memory is per instance — and a
throttled caller is refused whatever they typed, or the answer would say which
guess was right. Individual staff accounts would be a table and a sign-in per
person; this is the first version.

**A change must be JSON from the site's own pages** (`sameSiteJson`): a form on
another site can send neither, so a signed-in staff browser cannot be made to
post by one.

**An update's time is the server's clock unless staff change it.** The time box
starts on now to the minute; sent as it read, 15:40 was earlier than a
shipment made at 15:40:37, so the first update did not move the status. Found
by the browser walk, not a test. The status is the newest update's by when it
happened, so an update entered late for earlier in the day does not move a
parcel backwards.

## The server

**One Vercel function answers every `/api` path** (`vercel.json` rewrites
`/api/:path*` to `/api?route=:path*`), bundled by esbuild into
`api/handler.generated.js` — NetLet's lesson: a function Vercel only
transpiles can fail at the first request on imports every other tool resolves.
`pnpm smoke` runs the bundle from a folder with no `node_modules` in reach.

**`handle(Request) → Response` is the API**, so Vercel, `pnpm dev` and the tests
run the same code. The tests run it against PGlite with the real schema and
against the demo store, the same suite for both.

**The tables are made on the first request** (`ensureSchema`, every statement
`if not exists`, under an advisory lock so two instances starting at once do
not race), so setting ShipLee up is connecting a database. A later change to a
table is an `alter` added there. Row-level security is on with no policies,
which closes the tables to Supabase's public keys.

**It may live inside NetLet's Supabase project, walled off, on the owner's
word** (`shared-database.sql`): a `shiplee` schema and a `shiplee_app` login
with usage and create there and nothing else, `search_path = shiplee` so the
unqualified tables land there, at most 10 connections and 30 seconds a
statement. **Never NetLet's `postgres` login**, which would put NetLet's
customers and orders in ShipLee's Vercel settings. So keep every table name
unqualified and every statement inside what the login can do: no extension,
no `public.`, nothing a non-owner cannot run. Tried against Postgres 16 set up
as Supabase is (a non-superuser `postgres`, `anon` and `authenticated`):
ShipLee's own store made its four tables there as `shiplee_app`, and that login
was refused every NetLet table, reading and writing, and creating in `public`;
`anon` and `authenticated` were refused the `shiplee` schema.

**At most two connections per instance, and never more queries at once than
connections** (`db.ts`'s gate) — NetLet's lesson: postgres.js pipelines a query
onto a busy connection, and Supabase's transaction pooler never answers one
sent that way.

**No database means no tracking, said in words** — never invented parcels on a
real deployment. `SHIPLEE_DEMO=1` asks for four sample parcels in memory, and
`pnpm dev` turns it on when no database is set.

## ShipLee AI

**Gemini, through NetLet's Cloudflare Worker, named ShipLee AI, on the owner's
word** ("implement the AI that we have, Gemini, name it ShipLee AI, from the
Cloudflare Worker"). The Worker (`Backend/gateway`, NetLet's) holds the one
Gemini key; ShipLee's server asks it through a door of its own,
`POST /api/shiplee/generate`, with a token it signs for each call
(`server/gateway.ts`): NetLet's token format, `{ v: 1, app: "shiplee", task,
exp }`, signed with `SHIPLEE_AI_SECRET`, which the Worker holds as
`SHIPLEE_GATEWAY_SECRET`. **Never NetLet's secret**: neither project can mint
the other's tokens, and the door answers in words only (no photo, drawing or
search), so a leaked ShipLee secret spends no more than that. Since ShipLee
imports nothing from NetLet, the format is written twice, and **one fixed token
is checked on both sides** (`server/gateway.test.ts` and the Worker's
`index.test.ts`): change either and both fail. Unset, `/api/config` says
`ai: false` and nothing about it is drawn — and it needs a store too, because
that is where each caller is counted.

**Two jobs**, the rules pure in `shared/assistant.ts`, the routes in
`server/ai.ts`:

- **The customer's questions**, on the tracking page beside the facts and at
  the top of Help (`ShipLeeAI`). The model is given the help page's answers
  and, for a parcel, exactly `publicView` — never the recipient's name, phone
  or street, which a test reads the prompt for. Everything people typed (the
  sender's name, a staff note, a location, the question itself) is fenced in
  «» on one line. It answers as JSON — the words, whether the customer needs
  ShipLee's team, three follow-ups — and the page draws the team's buttons
  itself (`ContactActions`, the WhatsApp message and email subject carrying
  the number), so the model never writes a phone number. **A question carrying
  a phone number, an email or a link is said back under the box and never
  sent** (`carriesContact`, the same rule on both sides); a tracking number is
  not one (its check digit says so, with or without SL), nor is a date or a
  price, and a number typed into a question on Help is found and looked up.
  Thirty questions an hour per address (`MAX_ASKS_PER_HOUR`), counted in
  `ai_requests` before the call; a question refused for its contents is not
  counted.
- **The desk's order messages** ("Fill from a message", `FromMessage` on
  `/staff/new`): an order pasted from WhatsApp or email is read into the
  form's boxes, held to the form's own rules first (`readIntake`: a
  governorate one of six, a Kuwaiti phone or kept as typed so the form says
  so, pieces 1–99, an amount in dinars, a day not past). Nothing is created:
  the filled boxes are marked "From the message" until changed, the note says
  how many and which were not found, and Undo puts the form back. The message
  is not kept, and the box says it goes to Google's Gemini.

**Walked through the real Worker code**: `.scratch/shiplee-gateway.mts` serves
`Backend/gateway`'s own `handle` locally with only Gemini stood in, so a walk
exercises the token, the door and the call as deployed.

## The desk's day, filters, export and labels

**The day at a glance** (`summary`, Kuwait's day): waiting for pickup (and how
many were booked today), with drivers now and the cash they carry, delivered
today, and needing attention — each tile opening the shipments it counts.
**Filters by where a parcel stands** (`STATUS_GROUPS`: waiting, on the way,
with a driver, needs attention, delivered, returned or cancelled), each saying
its count for the current search before it is pressed, in the address with the
search. **Export** downloads what the list shows as a CSV (`server/csv.ts`): a
byte-order mark so Excel reads the Arabic, the headings in the desk's
language, Kuwait times, at most 5,000 rows, and a cell that starts like a
formula given an apostrophe, so a sender typed as `=HYPERLINK(…)` stays text.

**Labels**, one per piece, at `/staff/shipments/:id/label`, sized for
100 × 150 mm label paper and printed with the browser's own Print (`@page`,
measured: two pages of 282.96 × 425.04 pt for two pieces). Each carries the
tracking number as a Code 128 barcode and in large digits, the recipient, the
area and governorate, the address, the sender, the cash to collect, "Piece 1
of 2", the expected day and a QR code to the tracking page. **Captions in both
languages and the layout never mirrored**: a label is read by drivers and hubs
whatever the desk's language. **The barcode is drawn here** (`shared/code128.ts`)
because a library that writes `style` attributes is refused by the security
policy; every one of its 107 patterns is checked against jsbarcode in the
tests (a dev dependency only). **The QR code** is `qrcode-generator`'s
encoding drawn as one SVG path (`shared/qr.ts`), read back by jsQR in its
test. Label colours are their own tokens (`--label-ink`, `--label-paper`),
black on white whatever the palette. The desk is a chunk of its own, so a
customer's visit downloads none of it.

## The customer's pages, this round

**Recently tracked** (`src/recent.ts`): the last five numbers this device
found, each with the status last seen, in the home page's card, each
removable and Clear for all — on the device only, and only a number the server
found is remembered. **The tracking page** says when it last checked, with
Refresh, and asks again every minute while a parcel is moving and the page is
in view; Share hands the page's address to the phone's share sheet or the
clipboard; and "Need help with this parcel?" offers WhatsApp, a call and email
with the number already in the message. **On a phone the four steps are
rows**, the icon beside the words, rather than a card a screen tall each.

## Checks

`pnpm check`, `pnpm test`, `pnpm build`, `pnpm smoke`, run by
`.github/workflows/shiplee.yml` on every push touching this folder. Walk a
change at 320, 390 and 1440 in both languages with axe, and with the real
security policy once, listening for anything it blocks (`pnpm serve` serves
the build with `vercel.json`'s headers).
