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

**At most two connections per instance, and never more queries at once than
connections** (`db.ts`'s gate) — NetLet's lesson: postgres.js pipelines a query
onto a busy connection, and Supabase's transaction pooler never answers one
sent that way.

**No database means no tracking, said in words** — never invented parcels on a
real deployment. `SHIPLEE_DEMO=1` asks for four sample parcels in memory, and
`pnpm dev` turns it on when no database is set.

## Checks

`pnpm check`, `pnpm test`, `pnpm build`, `pnpm smoke`, run by
`.github/workflows/shiplee.yml` on every push touching this folder. Walk a
change at 320, 390 and 1440 in both languages with axe, and with the real
security policy once, listening for anything it blocks (`pnpm serve` serves
the build with `vercel.json`'s headers).
