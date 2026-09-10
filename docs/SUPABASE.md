# Setting up Supabase

Supabase is where NetLet's catalog, cart and accounts live. This is the step
that turns the demo into a real shop: until it is done, the site runs on
invented fixtures and nothing you add in `/admin` exists.

About fifteen minutes. Free tier is enough to start.

There are two routes through this. **Route A needs nothing installed** — you
work from the Supabase and Vercel dashboards in a browser. Route B is for when
you have the repository cloned and Node available. Do one, not both.

---

## 1. Create the project

1. Sign in at [supabase.com](https://supabase.com) and **New project**.
2. Name it `netlet`.
3. Set a **database password** and save it somewhere. This is not your Supabase
   account password, it is the one that goes in the connection string, and it
   is shown once. If it gets lost, reset it under Project Settings → Database.
4. Region: pick the one nearest Kuwait — **Central EU (Frankfurt)** is usually
   the closest available, and every page load pays this distance twice.
5. Wait for provisioning, a minute or two.

---

## 2. Create the tables

### Route A — from the Supabase dashboard (nothing to install)

1. In your project, open **SQL Editor** → **New query**.
2. Open [`docs/supabase-bootstrap.sql`](./supabase-bootstrap.sql) in this
   repository, copy the whole file, paste it into the editor.
3. **Run**.

That creates all fifteen tables and seeds the five departments and the house
vendor. It is safe to run more than once.

To confirm: **Table Editor** should now list `products`, `vendors`, `carts`,
`users` and the rest, and `categories` should hold five rows.

### Route B — from a clone

```sh
git clone https://github.com/almailgroup/netlet-project.git
cd netlet-project
pnpm install
cp .env.example .env      # then put DATABASE_URL in it, see step 3
pnpm db:push              # creates the tables
pnpm db:seed              # departments + house vendor
```

---

## 3. Get the connection string

Project Settings → **Database** → Connection string.

**Take the Transaction pooler one, port 6543.** Not the direct connection.
Vercel runs the backend as serverless functions — a new process per request —
and enough of those will exhaust a direct connection's pool. The pooler exists
for that case. (On a Mac mini or a VPS you would take the direct connection on
5432 instead; the app handles either, so it is only ever this one line.)

It looks like:

```
postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

Replace `[YOUR-PASSWORD]` with the database password from step 1. If it
contains `@`, `/`, `:` or `#`, percent-encode those characters or the URL
parses wrongly — easiest is to reset it to something alphanumeric.

---

## 4. Tell Vercel

Vercel project → Settings → **Environment Variables**. Add two:

| Name | Value |
|---|---|
| `DATABASE_URL` | the pooler string from step 3 |
| `JWT_SECRET` | `openssl rand -base64 48`, or any long random string |

`JWT_SECRET` signs the session cookie; without it nobody can sign in. Rotating
it later signs everyone out, which is the intended way to do that.

Then **remove `VITE_DEMO_MODE`** — this is the switch. While it is set, the
site answers from fixtures and never reaches the database at all.

Redeploy (Deployments → the latest → Redeploy). `VITE_*` variables are compiled
into the bundle at build time, so a redeploy is required; saving the setting is
not enough.

---

## 5. Become the administrator

1. On the live site, **register an account** with the email you want to
   administer NetLet from.
2. Back in Vercel, set `OWNER_EMAIL` to that same address and redeploy.
   That address is granted the admin role on registration — so if you
   registered first, promote yourself once by hand instead: Supabase → Table
   Editor → `users` → your row → set `role` to `admin`.
3. Open `/admin`. You should see Overview, Products, Stock, Review, Vendors,
   People and Team.
4. From `/admin/people` you can grant anyone else administrator, or add them
   to a vendor as staff, manager or owner — that is the page that decides who
   gets in from here on.

---

## 6. Add a product

`/admin` → Products → **New product**. A product needs, before it is worth
publishing:

- a **price** and **stock** on its variant,
- at least one **image** — the shop shows a grey box without one,
- a **department**, or it will not appear on any category page.

Then **Publish**. It appears in the shop immediately, because the storefront
reads the same tables the admin portal writes.

---

## Troubleshooting

| What you see | What it is |
|---|---|
| Site loads, catalog empty | `VITE_DEMO_MODE` still set, or set but the build was not redeployed |
| Every page loads, sign-in fails | `JWT_SECRET` missing |
| Errors mentioning connection or timeouts | Direct connection string used instead of the pooler, or the password is wrong or contains characters that need encoding |
| `/admin` says you have no admin account | Registered before `OWNER_EMAIL` was set — promote the row by hand, per step 5 |
| Admin loads but no vendor to add products to | The seed did not run. Re-run the bootstrap SQL; it is safe to repeat |
| A published product is not in the shop | Its vendor is not `approved`, or the product is `pending_review` rather than `published` |

## What Supabase is *not* doing here

Worth being clear, because Supabase offers all of these and NetLet uses none of
them:

- **Not Supabase Auth.** Passwords are in Firebase, and the session is our own
  httpOnly cookie. Supabase holds the `users` mirror row, nothing more.
- **Not Supabase's client SDK.** Nothing Supabase-shaped ships to the browser.
  The server talks to Postgres over the connection string and the client only
  ever talks to our own API.
- **Not row-level security.** Every query goes through `server/inventory.ts`,
  which refuses what the actor may not do before the query runs. RLS would be a
  second, quietly divergent copy of the same rules — the connection string is a
  server-side secret and is never handed to a browser.

Supabase here is a managed Postgres. That is deliberate: it means moving to
any other Postgres is a change to one environment variable.
