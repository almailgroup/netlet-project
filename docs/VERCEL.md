# Deploying NetLet to Vercel

Vercel runs the backend. GitHub Pages could not, which is why the published
site has been a fixture-backed demo with invented products. On Vercel the same
code serves your own catalog, real accounts, and a real cart.

Time: about ten minutes. Cost: nothing on the Hobby plan for a site this size.

---

## What changes, and what does not

The client is served from Vercel's CDN. `/api/*` goes to a serverless function
that is **the same Express app `pnpm dev` runs** — `Backend/src/core/app.ts`, one
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

This is the step that makes the admin portal's products appear in the shop.

1. Create a Supabase project and take the connection string. **`docs/SUPABASE.md`
   is the full walkthrough** — including how to create the tables from the
   Supabase dashboard alone, with nothing installed locally.

   Take the **Transaction pooler** string (port 6543), not the direct
   connection: Vercel runs the backend as serverless functions, and enough of
   those exhaust a direct connection's pool.
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

Add products at `/admin`. A product needs a price, stock and at
least one image before it is worth publishing — the shop shows a grey box for
a product with no picture.

### For accounts (sign-in, saved items, delivery area)

The two variables above are already what accounts need. Beyond them:

Then the three Supabase Auth values from `docs/SUPABASE-AUTH.md`, which are what
put a registration on the dashboard's Authentication page:

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

None of the three needs quoting — they are single-line values.
**`SUPABASE_SERVICE_ROLE_KEY` is a full-power secret**: it bypasses row-level
security, so keep it out of any `VITE_` name and rotate it in the dashboard if it
is ever exposed.

### Optional

```
AI_GATEWAY_URL              # The AI gateway (Backend/gateway/README.md): every model call goes through it
AI_GATEWAY_SECRET           # 32+ characters, the same value the Worker holds; either unset turns AI off
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

## Checking a live deployment

Two URLs, and they answer different questions:

| URL | Means |
|---|---|
| `/healthz` | The function itself is alive. Touches nothing else, so a failure here is the process, not a dependency. |
| `/readyz` | The database is reachable. `{"database":"ok"}`, or 503 with `unreachable` / `not configured`. |

`/readyz` reports a verdict and never the reason — connection strings and
driver messages are not for an unauthenticated caller. The reason goes to the
Vercel runtime log, with the driver's own error unwrapped from the wrapper
drizzle puts around it.

Every tRPC 500 is logged the same way. Before that existed, a failed query
returned 500 to the browser and wrote an empty line to the platform log, which
made a production fault a guessing game.

## Node version

The function needs **Node 22.x**. `engines.node` in `package.json` asks for it,
but Vercel's own **Settings → General → Node.js Version** overrides that, so set
it there too.

It used to matter sharply: `firebase-admin` pulled in `jwks-rsa`, which
`require()`d the ESM-only `jose`, and requiring an ES module from CommonJS only
works from Node 22.12 onward — below that the function was dead at load with
`ERR_REQUIRE_ESM`. That dependency is gone and nothing left here uses
`require()`, so 22.x is now just what the project is built and tested against.

