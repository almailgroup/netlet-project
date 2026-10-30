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
keep passwords in Firebase and wrote only a mirror row into `public.users`, so
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
and sign-in fall back to the local scrypt
digest if it is not.

---

## The three values

All from **Project Settings** in the Supabase dashboard.

### 1. `SUPABASE_URL`

**Project Settings → Data API → Project URL.** Looks like
`https://abcdefghijklm.supabase.co`.

**The origin alone, with no path after it.** That page also shows a RESTful
endpoint ending in `/rest/v1`, directly beside it. Every call here appends its
own path, so copying that one produces `/rest/v1/auth/v1/admin/users` — answered
by PostgREST with a 404, which reaches the register form as a redacted 500 with
the reason only in the log. `pnpm preflight` refuses a URL with a path and
prints the value you should have used instead.

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
None of these need quoting: they are single-line values copied from a page.

---

## Where the links in Supabase's emails go

Every email Supabase sends for NetLet — the reset link, and the sign-up email
until it shows the code — has a link that goes through Supabase and then on to
a page of the site. NetLet asks for its own sign-in page each time, and that
page reads what Supabase hands back: a reset to finish ("Choose a new
password"), a confirmed address, or a link that has expired.

**Supabase only sends people to an address it has been told about.** Anything
else goes to the project's **Site URL**, and a new project's Site URL is
`http://localhost:3000` — which on a shopper's phone is a blank page. A
shopper reported exactly that after pressing the link in the sign-up email.

**Authentication → URL Configuration**:

- **Site URL**: the shop's own address — `https://netlet.net` since the shop
  moved to its own domain. Any page on that host is then allowed.
- **Redirect URLs**: `https://netlet.net/**`. Nothing else: the shop answers
  on that address alone (`www.netlet.net` redirects to it).

NetLet names the address from `SITE_URL` when it is set, otherwise from
Vercel's production address, otherwise from the host the request came to — so
set `SITE_URL` to `https://netlet.net` in Vercel's environment variables.

---

## The reset email

Supabase composes and sends it, so there is no mail provider to configure — the
same property that let the reset link on the sign-in dialog be real rather than
decorative.

The link in it opens NetLet's sign-in page on **Choose a new password**. That
page sets the new password with the one-time token Supabase handed back and
signs the shopper in; the token is used for that alone and never kept. Before
this, the link signed into Supabase and changed nothing, because no page read
what came back. Supabase's default "Reset Password" email works as it is — it
needs only the Site URL above.

**The default project mailer is rate-limited and meant for development.** A real
deployment points Supabase at its own SMTP under **Project Settings →
Authentication → SMTP Settings**. That is a dashboard setting, not code.

The email templates are also in the dashboard, under **Authentication → Emails**.
Translating them is where the Arabic reset email would come from; NetLet passes
the shopper's language to the reset call but Supabase localises from the
template, not the request.

---

## The sign-up code

Create account is two steps. The shopper fills in their details (and ticks
Google's "I'm not a robot" box, when that is set up), and Supabase emails a
**six-digit code** to the address. The account exists only once that code is
typed back on the site — an address nobody has shown they read is not one
NetLet opens an account on. Signing in with the right password on an account
whose code never came back goes to the same step and sends a fresh code.

Three settings in the Supabase dashboard make it work, beside the Site URL
above. All three are switches or text boxes; none is code.

**1. "Confirm email" stays on.** **Authentication → Sign In / Providers →
Email → Confirm email.** It is on in a new project. Off, Supabase confirms
every address itself and sends nothing, so there is no code to type — NetLet
then makes the account on the spot and logs a warning, and `pnpm preflight`
refuses the configuration.

**2. The "Confirm signup" email shows the code.** **Authentication → Emails →
Confirm signup.** Supabase's default message is a link; NetLet asks for the
code, so the template has to print `{{ .Token }}`. Replace the subject and body
with something like this — both languages, because the email goes out before
anybody has chosen one:

Subject:

```
Your NetLet code: {{ .Token }} · رمزك في نت‑لت
```

Body (HTML):

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#0a285a">
  <h2 style="margin:0 0 12px">Confirm your email</h2>
  <p>Enter this code on NetLet to finish creating your account:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">{{ .Token }}</p>
  <p style="color:#536b8c;font-size:13px">If you did not try to create a NetLet account, ignore this email — nothing has been made.</p>
  <hr style="border:none;border-top:1px solid #e3e1d9;margin:24px 0">
  <div dir="rtl" style="text-align:right">
    <h2 style="margin:0 0 12px">أكّد بريدك الإلكتروني</h2>
    <p>أدخل هذا الرمز في نت‑لت لإكمال إنشاء حسابك:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0" dir="ltr">{{ .Token }}</p>
    <p style="color:#536b8c;font-size:13px">إن لم تحاول إنشاء حساب في نت‑لت، فتجاهل هذه الرسالة — لم يُنشأ شيء.</p>
  </div>
</div>
```

**Without `{{ .Token }}` nobody can finish creating an account.** The default
email is a "Confirm your mail" link and no code. A shopper reported exactly
that: they were told a 6-digit code was on its way, got a link instead, and
the link went to a blank page (the Site URL, above). Opening that link confirms
the address in Supabase, and the next sign-in used to make the NetLet account
there and then, without the code. It does not any more: **only the code makes
a shopper's account.** A sign-in to an account Supabase sent a sign-up email for
and NetLet has no account for is put back to waiting and sent a fresh code — so
with the default template that fresh email is a link again, and the shopper
goes round in a circle. Changing the template is what lets the code arrive.

Accounts you add by hand under **Authentication → Users → Add user** (with "Auto
Confirm User" ticked) are not sign-ups: Supabase sends them nothing, and they
become NetLet logins the first time they sign in, as before.

**3. Your own mail server.** **Project Settings → Authentication → SMTP
Settings.** Supabase's built-in mailer only sends to the email addresses of
your Supabase team and only a few an hour — enough to test with, not enough for
shoppers. Any SMTP provider works (Amazon SES, Resend, SendGrid, Zoho, Google
Workspace); it is a host, a port, a user and a password typed into that page.
The same server then sends the password-reset emails too.

While you are there, **Authentication → Rate Limits** sets how many emails an
hour Supabase will send in all; raise it to fit your traffic once your own SMTP
is in. NetLet also throttles on its side: ten codes a quarter of an hour per
address, and ten wrong codes before it stops checking for a while.

---

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
         when password_hash is not null then 'local digest'
         else 'none — cannot sign in'
       end as password_store
from public.users
order by created_at desc;
```

Exactly one of those columns is ever set. `Backend/src/core/passwordStore.ts` is the
only place that reads which, and `Backend/src/services/logins.ts` is what clears the other when
an account moves between them.

`users.firebase_uid` used to be a third: Firebase held every password until this
move. It was kept for one release, then dropped in migration 0035 once no row
carried one. Re-running `docs/supabase-bootstrap.sql` is what removes it from a
database that still has it.
