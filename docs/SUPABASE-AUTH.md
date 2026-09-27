# Supabase Auth for NetLet

Registered accounts live in Supabase Auth. This is what to click, in order, and
what each value is for.

Time: about five minutes, because you already have a Supabase project — it is the
one holding the database.

---

## Why this page exists

If you have been looking at **Authentication → Users** in the Supabase dashboard
and finding it empty after somebody registered, this is the reason. That page
reads `auth.users`, which belongs to Supabase's own auth service. NetLet used to
keep passwords in Firebase and write only a mirror row into `public.users`, so
the accounts were always in Supabase — one page over, in the table editor — while
the page you would naturally check was empty by construction.

With the three values below set, a registration creates the account in Supabase
Auth and it appears on that page.

## What this changes, and what it does not

**Supabase Auth holds the password**, along with the reset link and, later,
email verification and a second factor.

**`public.users` still keeps one row per shopper** — their id, email, name, and
the Supabase user id that links the two — because saved products, delivery area,
notification preferences and order tracking are all foreign keys to that row's
serial `id`. Moving the *credential* does not move the *shopper's data*.

**The password is checked on the server, not in the browser.** No Supabase SDK
is shipped to the client, no Supabase token is ever held in JavaScript, and the
session stays exactly what it was: NetLet's own httpOnly cookie. The tokens the
sign-in grant returns are read for the user they name and then dropped.

**Nothing throws if you skip this.** With the three values unset, registration
and sign-in fall back to Firebase if that is configured, and to the local scrypt
digest if it is not.

---

## The three values

All from **Project Settings** in the Supabase dashboard.

### 1. `SUPABASE_URL`

**Project Settings → Data API → Project URL.** Looks like
`https://abcdefghijklm.supabase.co`.

**This is not `DATABASE_URL`.** They point at the same project and are otherwise
nothing alike: `DATABASE_URL` is a Postgres connection string with your database
password in it, and this is the project's API origin with no secret in it at all.
Both are needed, and putting one where the other goes fails in a way that reads
as the wrong thing — a `postgres://` value here makes every sign-in a connection
error rather than a refusal.

### 2. `SUPABASE_ANON_KEY`

**Project Settings → API Keys → `anon` / `public`.**

This one is a public identifier rather than a secret — it is the key a browser
would normally hold. It is in the server's environment rather than under a
`VITE_` name only because the password check runs server-side.

### 3. `SUPABASE_SERVICE_ROLE_KEY`

**Project Settings → API Keys → `service_role`.**

**This is the most dangerous value in your `.env`.** It bypasses row-level
security and can read or change anything in the project. It must never be
shipped to the client, never put in a `VITE_` variable, and never pasted into a
support ticket or a screenshot. If it is ever exposed, rotate it in the dashboard
immediately.

The two keys are not interchangeable and NetLet deliberately does not treat them
as such: only the admin endpoints get the service-role key, and sign-in gets the
anon one. Sending the service key to the sign-in endpoint would mean every
sign-in request carried the key that owns the whole project, and one misplaced
log line would then be a breach rather than a nuisance.

---

## Put them in

Locally, in `.env`:

```
SUPABASE_URL=https://abcdefghijklm.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Then `pnpm preflight`, which names anything missing and refuses two mistakes
outright: a `SUPABASE_URL` that is not https, and the two keys being the same
value — which is the likeliest way to get this wrong and the most expensive.

On Vercel, the same three under **Settings → Environment Variables**. Unlike
`FIREBASE_PRIVATE_KEY`, none of these need quoting: they are single-line values.

---

## The reset email

Supabase composes and sends it, so there is no mail provider to configure — the
same property that let the reset link on the sign-in dialog be real rather than
decorative.

**The default project mailer is rate-limited and meant for development.** A real
deployment points Supabase at its own SMTP under **Project Settings →
Authentication → SMTP Settings**. That is a dashboard setting, not code.

The email templates are also in the dashboard, under **Authentication → Emails**.
Translating them is where the Arabic reset email would come from; NetLet passes
the shopper's language to the reset call but Supabase localises from the
template, not the request.

---

## Accounts that were already in Firebase

**They keep working, and they are not moved automatically.** A Firebase password
hash cannot be carried into Supabase — that is a property of the hashes, not a
missing feature — so the only ways across are "the shopper resets their password"
and "everybody is asked to".

So:

- Leave the four `FIREBASE_*` values set. `users.firebase_uid` still names those
  accounts, and sign-in still checks Firebase for them.
- New registrations go to Supabase from the moment the three values above are
  set.
- When you want the rest moved, `node scripts/migrate-auth-to-supabase.mjs`
  creates a Supabase account for every remaining login and emails each owner a
  reset link. It prints what it would do and changes nothing until you add
  `--commit`. **Everybody it moves has to set a new password**, which is why it
  is a deliberate step and not something that happens on deploy.
- Once `select count(*) from public.users where firebase_uid is not null` is
  zero, the four `FIREBASE_*` values can go, and so can `server/_core/firebase.ts`.

## One thing to check while you are in the dashboard

Supabase exposes the `public` schema through its Data API, and that is separate
from anything on this page. NetLet does not use it — the server talks to Postgres
directly over `DATABASE_URL` with a role that bypasses row-level security — so
whether the Data API is on makes no difference to the shop working.

It does make a difference to what the anon key is worth if it ever leaks. With
the Data API on and no row-level security on `public.users`, that key plus your
project URL is enough to read the table. Neither value is shipped to the browser
by NetLet, so nothing publishes them; the exposure would be a leaked `.env` or a
screenshot.

Two ways to close it, either is enough:

- **Project Settings → Data API → turn it off.** NetLet does not need it, and
  this is the smaller change.
- **Enable row-level security on the NetLet tables** and add no policies for
  `anon`. The server's own connection is unaffected — it does not go through
  PostgREST and its role is not subject to RLS.

This is not new with Supabase Auth: the tables have been in this project since
the database was. It is worth deciding once, now that there is an anon key in the
deployment.

## Where the accounts are, in both places

In Supabase: **Authentication → Users** for the credential, **Table Editor →
`users`** for the NetLet row. They are matched by `users.supabase_uid`.

In NetLet: **`/admin/people`**, which lists everyone with an account, newest
first, shoppers included — and is the one that also says their role and when they
last signed in.

```sql
-- Who has an account, and which store holds their password.
select id, email, name, role, created_at, last_signed_in,
       case
         when supabase_uid is not null then 'supabase'
         when firebase_uid is not null then 'firebase (legacy)'
         when password_hash is not null then 'local digest'
         else 'none — cannot sign in'
       end as password_store
from public.users
order by created_at desc;
```

Exactly one of those three columns is ever set. `server/_core/passwordStore.ts`
is the only place that reads which, and `server/logins.ts` is what keeps the
other two clear when an account moves between them.
