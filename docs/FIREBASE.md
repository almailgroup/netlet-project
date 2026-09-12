# Firebase Authentication for NetLet

Registered accounts live in Firebase. This is what to click, in order, and what
each value is for.

Time: about fifteen minutes. Cost: nothing — Firebase Authentication's free tier
covers email/password sign-in with no card on file.

---

## What this actually changes

Firebase holds the password. NetLet's Postgres keeps one row per shopper —
their id, email, name, and the Firebase uid that links the two — because saved
products, delivery area, notification preferences and order tracking are all
foreign keys to that row. Moving the *credential* to Firebase does not mean
moving the *shopper's data* out of the database.

The password is checked on the server, not in the browser. No Firebase SDK is
shipped to the client, no Firebase token is ever held in JavaScript, and the
session stays the same httpOnly cookie it was before. Nothing about how sign-in
feels changes.

If the four variables below are left empty, sign-in falls back to NetLet's own
scrypt password digest exactly as it works today. Nothing breaks while you set
this up.

---

## 1. Create the project

1. Go to <https://console.firebase.google.com> and sign in with the Google
   account that should own this.
2. **Create a project**. Name it `netlet` (or anything — the name is only a
   label; the *project ID* underneath it is what matters).
3. Google Analytics: **off** is fine. It is unrelated to accounts and can be
   turned on later.
4. Wait for provisioning, then **Continue**.

## 2. Turn on email/password sign-in

1. Left sidebar → **Build** → **Authentication** → **Get started**.
2. **Sign-in method** tab → **Email/Password** → **Enable** the first toggle.
   Leave "Email link (passwordless sign-in)" off.
3. **Save**.

At this point the **Users** tab is where every shopper who registers on NetLet
will appear.

## 3. Get the four values

### `FIREBASE_PROJECT_ID` and `FIREBASE_API_KEY`

1. Gear icon (top left, beside "Project Overview") → **Project settings**.
2. **General** tab. **Project ID** is there — copy it.
3. Scroll to **Your apps**. If there is no web app yet, click the **`</>`**
   (Web) icon, give it a nickname (`netlet-web`), **do not** tick Firebase
   Hosting, and **Register app**.
4. Firebase shows a `firebaseConfig` block. Copy the `apiKey` value.

The API key is a public identifier, not a secret — it appears in the page source
of every Firebase web app in the world. It lives in NetLet's server environment
only because the password check runs server-side.

### `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`

These two **are** secret.

1. Still in **Project settings** → **Service accounts** tab.
2. **Generate new private key** → **Generate key**. A `.json` file downloads.
3. Open it. You need two fields:
   - `client_email` — looks like
     `firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com`
   - `private_key` — a long block starting `-----BEGIN PRIVATE KEY-----`

**Do not commit that JSON file, and do not put it anywhere under `client/`.**
Anyone holding it can read and modify every account in the project. Delete the
download once the values are in your `.env`.

## 4. Put them where the app will read them

Two situations. Pick the one that matches you.

### On Vercel (no local checkout)

Vercel project → Settings → **Environment Variables**. Add four:

| Name | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | e.g. `netlet-a1b2c` |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-xxxxx@netlet-a1b2c.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | the `private_key` value from the JSON |
| `FIREBASE_API_KEY` | `AIzaSy…` |

**The private key is where this goes wrong.** On Vercel, paste it with **no
surrounding quotes**. Either of these works:

- The one-line form straight out of the JSON, with literal `\n` between the
  lines: `-----BEGIN PRIVATE KEY-----\nMIIEvQ…\n-----END PRIVATE KEY-----\n`
- The real multi-line key, newlines and all. Vercel accepts a multi-line value,
  and the server handles both.

What breaks it is **wrapping it in `"…"`**. A `.env` file needs those quotes;
Vercel does not, and stores them as part of the value, so the key fails to
parse. This is the opposite of the by-hand instructions below — take care which
you are following.

Then **redeploy**. These are read at boot, so a save alone changes nothing.

### In a local `.env`

There is no `.env` in a fresh clone — it holds secrets, so it is gitignored and
never committed. `.env.example` is the template it is made from.

The short way, which does the escaping for you:

```sh
pnpm setup:env ~/Downloads/netlet-a1b2c-firebase-adminsdk-9xk2p.json --api-key=AIzaSy...
```

That reads the service-account JSON, writes `FIREBASE_PROJECT_ID`,
`FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` in the form the file needs,
generates `JWT_SECRET` if it is still blank, and leaves every value you have
already set alone. It never prints a secret, only the names of the keys it set.

By hand, the file wants:

```sh
FIREBASE_PROJECT_ID=netlet-a1b2c
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@netlet-a1b2c.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN...\n-----END PRIVATE KEY-----\n"
FIREBASE_API_KEY=AIzaSy...
```

Here the double quotes **are** required, on one line, with the newlines left as
the two characters `\n` — exactly as the JSON writes it. dotenv turns them back
into real newlines; a raw platform variable does not, which is why the two
sections differ.

### Either way

- **All four or none.** With any one missing, NetLet uses the local password
  path instead. That is deliberate, not a bug — but it means a typo in one
  variable looks like "Firebase isn't working" rather than an error.
- `DATABASE_URL` and `JWT_SECRET` are still required. Firebase replaces the
  password store, not the database or the session cookie.

## 5. Make sure the database is there

Firebase holds the password; Postgres holds the shopper. Registration writes
both, so without a database there is nothing to sign in *to* — see
`docs/SUPABASE.md`. If you already have it, the schema is current: `users`
carries `firebase_uid`, and `password_hash` is optional.

Existing accounts keep working: they still have their scrypt digest, and the
first time one of them signs in after you have also created them in Firebase,
their row is adopted rather than duplicated — same id, same saved products.

## 6. Check it

Register a new account on the site, then look at **Firebase console →
Authentication → Users**. The address should be listed, with a creation
timestamp. That is the whole test: if it is there, accounts are in Firebase.

Sign out and back in to confirm the password check works.

Locally that means `pnpm dev` first. On Vercel, just use the deployed site
after the redeploy.

---

## Migrating the accounts you already have

If people have already registered against the current scrypt table, their
passwords **cannot** be moved into Firebase — a scrypt digest is one-way, which
is the point of it. Two honest options:

- **Leave them.** An account with a local digest and no Firebase uid keeps
  signing in through the fallback path. New registrations go to Firebase. The
  two coexist indefinitely.
- **Import them.** Firebase's CLI can take scrypt hashes
  (`firebase auth:import --hash-algo=SCRYPT …`), but it wants Firebase's own
  scrypt parameters, which are not the ones `server/_core/password.ts` uses.
  In practice this means asking those shoppers to reset their password.

Given how few accounts exist today, leaving them is the right answer.

---

## What you get next, for free

Now that Firebase owns identity, these are configuration rather than
development:

- **Password reset by email** — Authentication → Templates. Firebase sends the
  message and hosts the reset page.
- **Email verification** before an account can order.
- **Google / Apple sign-in** — one more provider toggled on in the same
  Sign-in method tab.
- **Blocking abuse** — Authentication → Settings has rate limits and a domain
  allowlist.

None of these are wired into the storefront yet. They are listed so you know
what the switch bought.

---

## Troubleshooting

**"Email or password is incorrect" for a password you know is right.**
The account is in the local table, not Firebase, and Firebase is now configured
— so sign-in is asking Firebase about an address it has never heard of. Either
register the address in Firebase console → Authentication → **Add user**, or
clear the Firebase variables to go back to the local path.

**Registration fails with an opaque error and the server log mentions
`DECODER routines::unsupported` or an invalid PEM.**
`FIREBASE_PRIVATE_KEY` is malformed. In a `.env` it must be the quoted
single-line form with literal `\n`; on Vercel it must have **no** quotes at
all — a stray `"` at each end is the usual cause there. See step 4.

**Everything still uses the old password table.**
One of the four variables is empty or misspelled. The server checks all four
together before it uses Firebase at all. The values are read at boot, so
restart after editing `.env` — or redeploy, on Vercel.

**`Firebase sign-in failed with HTTP 403`.**
The Identity Toolkit API is not enabled for the project, which happens if the
project was created outside the Firebase console. Enable "Identity Toolkit API"
in the Google Cloud console for the same project.
