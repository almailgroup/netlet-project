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

Every colour is a token at the top of `src/styles.css` (`--brand`, `--brand-strong`,
`--brand-tint`, …). A new palette is an edit to that block and nothing else;
check that text still reads at 4.5:1 on what it sits on.

## Layout

```
shared/     the rules both sides use: tracking numbers, statuses, the form's checks, ShipLee AI's
            prompts and readers (assistant.ts), the label's barcode and QR code, English and Arabic
server/     the API (handle.ts), the database (db.ts, schema.ts, store.ts), staff sign-in (auth.ts),
            ShipLee AI (ai.ts, gateway.ts), the export (csv.ts)
api/        the Vercel function: a two-line stub over the bundle `pnpm build` writes
src/        the website: pages/, components/, staff/ (the desk)
scripts/    the function bundle, the smoke test, the local server
```

`CLAUDE.md` says why each piece is the way it is.
