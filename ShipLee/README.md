# ShipLee

Track a parcel at **shiplee.delivery**. Customers type a tracking number and see
where the parcel is, what has happened to it and when it arrives; ShipLee's
staff create shipments and add each update from the staff desk at `/staff`.
English and Arabic, on phones first.

It lives in the NetLet repository and shares NetLet's design language, but it
is its own project: its own `package.json`, its own Vercel project, its own
database. Nothing here imports NetLet and nothing in NetLet imports this.

## Running it

```bash
cd ShipLee
pnpm install
pnpm dev        # http://localhost:5090 — demo parcels, staff password shiplee-dev-desk
```

With no database, `pnpm dev` answers from four sample parcels and prints the
staff desk's password. Set `DATABASE_URL` in `ShipLee/.env` to use a real one.

## Checks

```bash
pnpm check      # TypeScript
pnpm test       # the rules, and the API against real Postgres (PGlite) and the demo store
pnpm build      # the site, and the API bundled into one file for Vercel
pnpm smoke      # runs that bundle with no node_modules in reach and asks it real questions
pnpm serve      # the built site on http://localhost:5091, as Vercel serves it
```

`.github/workflows/shiplee.yml` runs the first four on every push that touches
this folder.

## Putting it on shiplee.delivery

1. **A database.** Either create a Supabase project (the same region as the
   Vercel function, London, keeps each query short) and copy its
   *Transaction pooler* connection string, or in the Vercel project use
   *Storage → Create Database* and pick a Postgres provider, which sets
   `DATABASE_URL` or `POSTGRES_URL` for you.
   There is nothing to paste: the tables are made on the first request.

   **Or share NetLet's Supabase project, walled off.** In NetLet's project,
   SQL Editor → New query, paste `shared-database.sql` with a password of
   your own on its `shiplee_password` line (20 or more letters and numbers),
   and run it. It makes a `shiplee` section of the database and a
   `shiplee_app` login that can use that section and nothing else: every
   NetLet table refuses it, and it may hold at most 10 connections and run
   a query for at most 30 seconds. `DATABASE_URL` is then NetLet's
   *Transaction pooler* string with the user `postgres.<ref>` changed to
   `shiplee_app.<ref>` and that password. Never give ShipLee NetLet's own
   `postgres` login: ShipLee's Vercel project would then hold the key to
   NetLet's customers and orders.
2. **A Vercel project.** *Add New → Project*, import this repository, and set
   **Root Directory** to `ShipLee`. Vercel reads `ShipLee/vercel.json` for the
   rest — install, build, output, the function and the headers. Leave
   *Framework Preset* as *Other*.
3. **Environment variables** (Settings → Environment Variables, Production):
   `DATABASE_URL` (unless step 1 set `POSTGRES_URL`), `STAFF_PASSWORD` (12
   characters or more), and the contact details you want on the help page:
   `SHIPLEE_PHONE`, `SHIPLEE_WHATSAPP`, `SHIPLEE_EMAIL`. Redeploy after.
   ShipLee AI is two more, below; leave it for later if you like.
4. **The domain.** Settings → Domains → add `shiplee.delivery`, and
   `www.shiplee.delivery` redirecting to it. Vercel then shows the DNS records
   to add where the domain was bought — an **A** record for `shiplee.delivery`
   and a **CNAME** for `www` — or its nameservers to use instead. Copy them
   from that page rather than from here, since Vercel changes them from time
   to time. The certificate follows by itself once they resolve.
5. **Check it.** `https://shiplee.delivery/api/health` answers
   `{"ok":true,"store":"postgres","staff":true}` once the database and the
   password are in. Sign in at `/staff`, create a shipment, and track it.

A push that changes nothing in `ShipLee/` does not rebuild ShipLee
(`ignoreCommand` in `vercel.json`).

## Turning on ShipLee AI

ShipLee AI is Gemini, reached through NetLet's Cloudflare Worker
(`Backend/gateway` in this repository), which already holds the Gemini key. It
answers customers' questions on the tracking page and the Help page, and reads
an order message into the new-shipment form on the staff desk. ShipLee has a
door of its own on the Worker, with a secret of its own — never NetLet's.

1. **Make a secret**, 32 characters or more:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
2. **Give it to the Worker.** Cloudflare dashboard → Workers & Pages →
   `netlet-ai-gateway` → Settings → Variables and Secrets → Add → type
   *Secret*, name `SHIPLEE_GATEWAY_SECRET`, the value from step 1 → Deploy.
   (Or `npx wrangler@4 secret put SHIPLEE_GATEWAY_SECRET` from `Backend/gateway`.)
   `https://<the Worker's address>/healthz` then says `"shiplee": true`.
3. **Give it to ShipLee.** In ShipLee's Vercel project: `SHIPLEE_AI_URL` = the
   Worker's address (the same as NetLet's `AI_GATEWAY_URL`, no trailing slash)
   and `SHIPLEE_AI_SECRET` = the same value as step 2. Redeploy.

`https://shiplee.delivery/api/config` then says `"ai": true`, and "Ask ShipLee
AI" appears. Unset, nothing about it is drawn. The Gemini project's spending
cap covers ShipLee too; each customer may ask 30 questions an hour, and the
desk read 120 messages an hour.

## Changing the colours

Every colour, type size, space, corner, shadow and timing is a token in
`src/styles/tokens.css`, and nothing else in the stylesheet writes a raw
value. A new palette is an edit to that file alone; check that text still
reads at 4.5:1 on what it sits on (the file lists each pairing as measured).
`/styleguide` draws every part in every state with the tokens as they are.

## Pages

**Live** — what a customer sees on shiplee.delivery:

| Page | What it is |
|---|---|
| `/` | Track a parcel: the box, recently tracked, what ShipLee does, the parcel's four steps, an invitation to shops, common questions; parcels go round a road about the band's words, with a pause button |
| `/track/SL…` | One parcel: its status, the five steps, the expected day, what to do (reschedule, change the address, report a problem), the route and the updates |
| `/track/SL…,SL…` | Several parcels, a row each |
| `/track` | The tracking box on its own, with recently tracked |
| `/help` | Questions, ShipLee AI (when on), the ways to reach the team, more help, your privacy |
| `/contact` | The ways to reach the team, what to do about a parcel, sending for a shop |
| `/report` | Report a problem: the number, then what happened, sent on WhatsApp or by email |
| `/scams` | What ShipLee does and never asks for, and what to do with a message you doubt |
| anything else | Page not found, with the tracking box |
| `/staff` | The staff desk (password) |

Also on every customer page: a service notice when one is set
(`src/content/serviceAlert.ts`) and a WhatsApp button when `SHIPLEE_WHATSAPP`
is set.

**Preview** — designed, not connected, with sample data and a Preview mark.
Shown on a demo deployment (`SHIPLEE_DEMO=1`, or `pnpm dev` with no database),
or on a device that turned preview on at `/preview`. Anywhere else each
address is the page not found, and none is in the sitemap.

| Page | What it is |
|---|---|
| `/services` | The services, with prices from the sample rate rule |
| `/rates` | A rate calculator |
| `/book` | Booking a delivery in four steps |
| `/locations` | A drop-off point finder with a place for the map |
| `/signin`, `/signup`, `/account` | Signing in, creating an account, and an account's page |
| `/about`, `/careers`, `/couriers` | About ShipLee, openings, and signing up to deliver |
| `/styleguide` | Every part of the design in every state |
| on `/track/SL…` | Notifications, the driver's map, the photo at the door |
| on `/` | Sample figures and sample quotes |

## Where it connects later

Each preview piece is built to be wired up without being redrawn:

- **Rates and services** — `src/samples/rates.ts` is the only place prices
  come from. A price list the server keeps (or an API that quotes a booking)
  replaces it with the same lines.
- **Booking** — "Book the delivery" on the last step sends the three parts to an API
  that creates the shipment (the staff desk's create, opened to customers)
  and answers with the tracking number; the rules are already the shipment
  form's (`shared/shipment.ts`).
- **Locations** — `src/samples/locations.ts` becomes a list the server keeps;
  the place drawn for the map becomes one.
- **Accounts** — an accounts API behind `/signin` and `/signup`, and a session
  that `/account` reads instead of its sample parcels and addresses.
- **Notifications** — the tracking page's sign-up sends the number and the
  channel to an API that texts, WhatsApps or emails each update.
- **The driver's map and the photo at the door** — the driver's app reporting
  a position and a photo, which the tracking page then shows in the drawn
  places.
- **Becoming a courier and careers** — the form's answers sent to the team
  (an API, or the WhatsApp message the requests already use).
- **The service notice** — a notice the staff desk writes, served by
  `/api/config`, in place of the constant.
- **Figures and quotes** — real numbers from the shipments and real
  customers' words, in place of the samples on the home page.

Reschedule, change the address and report a problem are already live: each
ends in a message the customer sends on WhatsApp or by email, written for
them with the number in it. An inbox on the staff desk would be the next step.

## Layout

```
shared/        the rules both sides use: tracking numbers, statuses, the form's checks, customer
               requests (requests.ts), ShipLee AI's prompts and readers (assistant.ts), the label's
               barcode and QR code, and the words in English and Arabic (i18n.ts, copy/)
server/        the API (handle.ts), the database (db.ts, schema.ts, store.ts), staff sign-in (auth.ts),
               ShipLee AI (ai.ts, gateway.ts), the export (csv.ts)
api/           the Vercel function: a two-line stub over the bundle `pnpm build` writes
src/           the website
  pages/       the customer's pages; pages/preview/ the preview pages
  components/  the frame and shared pieces; components/ui/ the design system's parts
  staff/       the staff desk
  styles/      the stylesheet in parts, tokens.css first
  samples/     the preview's sample prices and drop-off points
  content/     the service notice
scripts/       the function bundle, the smoke test, the local server
```

`CLAUDE.md` says why each piece is the way it is.
