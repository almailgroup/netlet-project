# Deploying NetLet to Vercel

Vercel runs the backend. GitHub Pages could not, which is why the published
site has been a fixture-backed demo with invented products. On Vercel the same
code serves your own catalog, real accounts, and a real cart.

Time: about ten minutes. Cost: nothing on the Hobby plan for a site this size.

---

## What changes, and what does not

The client is served from Vercel's CDN. `/api/*` goes to a serverless function
that is **the same Express app `pnpm dev` runs** — `server/_core/app.ts`, one
copy of the routes, no second implementation to drift.

Three things follow from that:

- **Environment variables live in the Vercel dashboard**, not a `.env` file.
  This is the answer to "I can't find the .env" — on Vercel there isn't one.
- **The base path becomes `/`.** On Pages the site lived at
  `/netlet-project/`; on Vercel it is the domain root. Do **not** set
  `VITE_BASE_PATH`.
- **GitHub Pages keeps working** until you turn it off. The two can run side by
  side while you check the Vercel one.

---

## 1. Import the repository

1. <https://vercel.com/new> → **Continue with GitHub** → pick
   `almailgroup/netlet-project`.
2. Vercel reads `vercel.json`, so leave the build settings alone. For the
   record, it is doing:
   - Build command `pnpm vercel-build` (which is `vite build`)
   - Output directory `dist/public`
   - `/api/*` → the function in `api/index.ts`
   - everything else → `index.html`, so client-side routes like
     `/category/electronics` load directly instead of 404ing
3. **Do not deploy yet** — set the variables first, because `VITE_`-prefixed
   ones are read at build time and a deploy without them bakes in the wrong
   thing.

## 2. Set the environment variables

**Settings → Environment Variables.** Apply each to Production, Preview and
Development unless noted.

### Start here — deploy today, with the demo catalog

Until Supabase is connected there is no catalog, so set exactly one variable
and deploy:

```
VITE_DEMO_MODE = true
```

That gives you the site you have now, at a Vercel URL, with the backend wired
and waiting. `VITE_` variables are compiled into the bundle at build time, so
changing this one later needs a redeploy, not just a save.

### Switching on the real catalog

This is the step that makes the dashboard's products appear in the shop.

1. Create a Supabase project and take the connection URI (Project Settings →
   Database → Connection string → URI).
2. Set the two variables below in Vercel.
3. Locally, with the same `DATABASE_URL` in your `.env`, run:

   ```
   pnpm db:push     # creates the tables
   pnpm db:seed     # departments + the house vendor
   ```

   The seed writes no products. An invented catalog on a live domain looks
   like an open shop.
4. **Remove `VITE_DEMO_MODE`** from Vercel and redeploy.
5. Register your `OWNER_EMAIL` account on the site, then run `pnpm db:seed`
   again — it puts that account in the house vendor so the vendor-side pages
   have something real behind them.

```
DATABASE_URL    postgresql://…            # Supabase; see .env.example
JWT_SECRET      <openssl rand -base64 48> # signs the session cookie
```

Add products at `/dashboard`. A product needs a price, stock and at
least one image before it is worth publishing — the shop shows a grey box for
a product with no picture.

### For accounts (sign-in, saved items, delivery area)

The two variables above are already what accounts need. Beyond them:

Then the four Firebase values from `docs/FIREBASE.md`:

```
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
FIREBASE_API_KEY
```

**`FIREBASE_PRIVATE_KEY` on Vercel:** paste the key from the service-account
JSON **with its `\n` escapes intact**, exactly as the JSON writes it, quotes
included. Vercel stores it verbatim; the server converts the escapes back. This
is the same trap as the `.env` file, and the same fix.

### Optional

```
MISTRAL_API_KEY             # AI search refinement; without it search falls back to local filtering
VITE_ANALYTICS_ENDPOINT     # Umami; both are public, both are build-time
VITE_ANALYTICS_WEBSITE_ID
```

### Do not set

```
VITE_BASE_PATH    # Pages needed it; on Vercel the site is at the root
PORT              # Vercel decides
```

## 3. Deploy

**Deploy**. Two minutes. You get a URL like
`netlet-project.vercel.app`, and every push to `main` redeploys — pull
requests get their own preview URL automatically.

## 4. Check it

```
https://<your-url>/healthz
```

should answer `{"status":"ok","uptime":…}`. That is the serverless function
replying, so a healthy response means the backend is wired even if the catalog
is not configured yet.

Then open the site and check a client-side route directly —
`/category/all` — rather than only the home page. If that 404s, the SPA
rewrite is not being applied and the problem is `vercel.json`, not your build.

---

## Once you are happy

Turn GitHub Pages off in the repository's **Settings → Pages** so the two
cannot drift, and point the iOS shell at the new URL:
`MOBILE_STOREFRONT_URL` in `ios-app/src/webStorefront.ts`.

For a custom domain (`netlet.com` or similar): **Settings → Domains**, add it,
and follow the DNS records Vercel gives you. TLS is automatic.

---

## Things worth knowing

**Rate limiting is per-instance.** `express-rate-limit` counts in memory, and
serverless means several instances. The limits still work but are looser than
the numbers suggest. If it starts mattering, move the counter to Redis
(Vercel KV) — nothing else has to change.

**The database connection is per-instance too.** `postgres-js` is created
lazily and reused for the life of a warm instance. If you see connection-limit
errors from Supabase under load, switch `DATABASE_URL` to the transaction
pooler on port 6543 — the client already sets `prepare: false`, so the pooler
is safe to point at.

**Cold starts.** The first request after a quiet period takes a second or so
while the function boots. Static pages are unaffected — they come from the CDN.

**This has not been tested against Vercel itself.** The app was verified
locally on both path shapes it can receive, and the long-running server still
works unchanged, but nobody has watched an actual Vercel deploy of it. If the
first one fails, the build log will say why and the likely suspects are the two
things above: a `VITE_` variable missing at build time, or the private key's
escapes.
