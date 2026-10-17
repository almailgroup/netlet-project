# NetLet

A Kuwait-first marketplace: one storefront, many vendors, English and Arabic.

React 19 + Vite on the client, Express + tRPC on the server, Postgres
(Supabase) for the catalog, the cart and accounts, and Supabase Auth for the
passwords — so a registration appears under Authentication in the same project.
Vercel runs it.

## Getting started

```bash
pnpm install
pnpm setup:env        # writes .env from .env.example
pnpm preflight        # says, by name, what is still unset
pnpm db:push          # schema
pnpm db:seed          # departments and the house vendor — no invented catalog
pnpm dev              # http://localhost:3000
```

Nothing throws at boot on a missing value: an unset variable turns a feature
off rather than preventing startup, so `pnpm dev` works before any of the
third-party accounts exist. `pnpm preflight` is what tells you which features
are currently dark.

Setting up a database from the Supabase dashboard with nothing installed
locally: paste `docs/supabase-bootstrap.sql`. It is idempotent, so the answer
to "my database is behind" is always to run it again.

## Checks

```bash
pnpm check     # tsc --noEmit
pnpm test      # vitest — data-layer tests run a real Postgres via PGlite
pnpm build     # client bundle + server bundle
pnpm smoke     # serves the Vercel function with no node_modules in reach
```

CI runs all four on every push. The fourth is the one the others cannot
replace: `check`, `test` and `build` all resolve imports more generously than
plain Node does, and all three have passed green on a function that could not
boot.

## Layout

```
client/          React app — Vite, wouter, Tailwind v4
  src/pages/       one file per route, admin/ for the portal
  src/components/  admin/ and browse/ for the two that have several
  src/hooks/       useAuth, useCompactHeader
  src/lib/         trpc client, formatting, demo link
  src/contexts/    cart and customer state
server/          Express + tRPC
  _core/           infrastructure: app, auth, env, security, trpc, entry points
  routers/         one router per surface
  *.ts             the data layer — inventory, orders, catalog, profile
shared/          imported by both sides, and pure
  commerce/        the Product shape, browse logic, order arithmetic
  inventory/       permissions, commission, vendor health
  i18n/            one dictionary, English and Arabic
  auth/            password rules, rate-limit policy
  ai/              the AI gateway's contract: tokens, requests, the stream
drizzle/         schema and migrations
workers/         Cloudflare Workers, deployed on their own
  ai-gateway/      holds the Gemini key; README.md is its setup
docs/            setup guides and the requirements
scripts/         setup, seed, preflight, bootstrap and smoke
ios-app/         Expo WebView shell, with its Xcode project committed
```

**`shared/` is pure on purpose.** Permissions, commission, the order
arithmetic, the password floor — each decides something that costs money or
access, and a rule you can only exercise by running the whole stack is a rule
nobody checks. The server imports the same function the client does, so the UI
cannot offer what the API refuses.

**Guards sit beside the query they protect**, in the data layer, not in the
router alone. A router-level check is one that a second caller added later
skips silently.

## Documentation

| | |
|---|---|
| [`docs/VERCEL.md`](docs/VERCEL.md) | Deploying — the supported target |
| [`docs/SUPABASE.md`](docs/SUPABASE.md) | Database setup |
| [`docs/SUPABASE-AUTH.md`](docs/SUPABASE-AUTH.md) | Authentication setup — where registered accounts live |
| [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) | Running it on your own hardware |
| [`docs/MISTRAL.md`](docs/MISTRAL.md) | The search-refinement API contract |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | What was asked for |
| [`CLAUDE.md`](CLAUDE.md) | Why the code is the way it is — read this before changing it |

`CLAUDE.md` is the architecture document. It records the decisions and, more
usefully, the ones that were wrong the first time.

## Status

The storefront, the catalog, the vendor model, the admin portal and accounts
all work against a real database. **Nothing can be bought yet**: orders exist,
payments do not, so checkout stops at an order in `pending_payment`. That is
the current phase of work rather than an oversight — an order has to exist
before a payment can reference it.
