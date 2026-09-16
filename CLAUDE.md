# NetLet

Kuwait-first marketplace storefront. React + Vite client, Express + tRPC server,
Supabase Postgres for the catalog, the cart and accounts. Firebase holds the
passwords. Vercel runs it.

## Layout

`README.md` has the directory map; two boundaries in it are load bearing.

**`shared/` is pure**, and that is what makes the rules checkable: permissions,
commission, order arithmetic and the password floor each decide something that
costs money or access, and both sides import the same function, so the UI
cannot offer what the API refuses.

**`server/_core/` is infrastructure and the rest of `server/` is the data
layer** — app, auth, env, security, trpc and the two entry points on one side;
inventory, orders, catalog, profile on the other. `_core` used to mean three
different things: there was a `shared/_core/` holding one dead file and a
`client/src/_core/hooks/` holding one hook while `client/src/hooks/` held four.
Both are gone, so the prefix now names one idea in one place.

Everything under `client/src/hooks/` is a hook and everything in
`client/src/lib/` is not; there is no second answer to where either goes.

## Design reference

`almailgroup/netlet-old-design`, branch `claude/shiplee-tracking-website` — an
earlier vanilla HTML/CSS build of NetLet. Treat it as a source of design ideas,
not of code: it is a different stack and a different palette.

Read it for layout and treatment. Worth knowing what is in there:

- The glass is on the header _bar_, not just its controls:
  `rgba(247,246,242,0.75)` under `blur(25px) saturate(210%)`. More translucent
  and more saturated than the current header, which sits at 0.95.
- The mobile bottom bar floats with a 24px radius, an upward shadow, and
  `env(safe-area-inset-bottom)` — that last part is where the current mobile
  nav's home-indicator fix came from.

**Its palette is a different direction** — yellow `#FEEE00`, blue `#1E3A8A`,
soft orange `#ffa86e`. The current brand is navy `#0a285a`, orange `#f2683a`,
pearl `#f3f2ed`. Do not carry the old colours across without asking.

## Buttons

One rule, and it is easy to break by accident. The three filled tints
(`.glass-navy`, `.glass-accent`, `.glass-on-dark`) share a construction: solid
fill, a single hairline along the top edge, a soft inner shade at the bottom, a
restrained rim. **No diagonal wash and no hover sweep** — over a filled surface
those read as glare.

The clear tint (`.glass`) keeps both, because on a near-transparent surface they
are what makes the glass legible at all.

`backdrop-filter` on an opaque fill is wasted work; only the clear tint and
`.glass-field` carry it.

## Accounts

Registered accounts live in **Firebase Authentication** — the password, and
later the reset and verification flows that come with it. `users` in Postgres
keeps one mirror row per shopper, linked by `firebase_uid`, because saved
products, delivery area, notification preferences and order tracking are all
foreign keys to its serial `id`.

The password is checked server-side, through Identity Toolkit rather than the
Firebase Web SDK, so no Firebase code ships to the client and the session stays
the same httpOnly cookie. `docs/FIREBASE.md` is the setup.

With the four `FIREBASE_*` variables unset, the same endpoints fall back to the
local scrypt digest in `password_hash`. Exactly one of the two is set on any
given account.

## Signing in

`AuthDialog` is sign in, create account and reset in one overlay, switched by
a real `tablist` rather than a link at the foot. Three things there are
deliberate:

- **The password can be shown.** Typing a long password blind is how people
  end up choosing a short one.
- **The strength meter names what is missing.** `shared/auth/passwordStrength.ts`
  returns the unmet rules, not just a score, because a bar that goes red tells
  somebody they failed without telling them how to stop. Only length and a
  common-shape check actually block: composition rules that refuse a long
  passphrase in favour of `P@ss1` make passwords worse.
- **Reset sends a real email.** Firebase composes and sends it through
  `accounts:sendOobCode`, so there is no mail provider to configure — which is
  the only reason the link can be real rather than decorative. The reply is
  identical for an address with no account, like sign-in, so it cannot be used
  to ask who is registered.

`ProfileManager` on `/account` is the other half: display name, sign-in email
and password, each its own small form with its own Save. One Save across all
three would change a password somebody opened the panel to fix a spelling in.
**Email and password both re-ask for the current password** — a session left
open on a shared machine should not be enough to take an account over, and
those two are exactly what somebody doing that would reach for. `server/profile.ts`
holds the writes rather than `db.ts`, because functions inside `db.ts` call
its module-local `getDb`, which nothing outside can redirect, so anything
living there cannot be tested against a real database.

The password floor is the *same* function on both sides:
`newPassword` in the auth router refines on `checkPassword().acceptable`, so
the API cannot accept what the form refuses. Sign-in is deliberately not held
to it — an account made before a rule existed must still be able to get in and
change it.

**The header opens the profile; it does not sign you out.** Home's own header
used to sign out on one click, which put the most destructive thing available
there under the friendliest label on the bar, beside the cart and the language
switch where nothing else costs anything. `StoreHeader` and `MobileTabBar`
already went to `/account`; Home now does too, and signing out lives on that
page behind its confirmation, next to everything else about the account.

**Signing out asks first**, on the account page. `ConfirmDialog` is what asks, and its confirm button
carries the verb rather than "OK" — somebody who opened it by accident reads
the button, not the paragraph. Cancel takes focus on open, so a stray Enter
gives the safe answer.

**Sign-in throttling counts in Postgres, not in memory.** The
`express-rate-limit` layer in `_core/security.ts` is still there and still
blunts a flood before it reaches application code, but its store is a `Map`
that assumes one long-lived process: served from a pool of short-lived
instances, each starts empty, so the real ceiling is the number times however
many are warm and it resets whenever one recycles. `server/rateLimit.ts` counts
in a table every instance shares, and `shared/auth/rateLimit.ts` is the policy,
pure.

Two keys, because each catches what the other cannot see: by address alone, one
office NAT hitting the ceiling locks out the whole building; by account alone,
nothing stops one host spraying a common password across a thousand addresses.
**Only failures count**, which is what makes an address ceiling safe to have —
an office where everybody signs in successfully never approaches it. Signing in
clears the *account's* record but deliberately not the address's, or one
attacker with an account of their own could launder their history at will. A
throttled caller gets `TOO_MANY_REQUESTS`, never "wrong password" — behaving
differently for the right password would make the throttle an oracle.

Password reset is throttled too, and there it counts every request rather than
every failure: the reply is identical for an address with no account, on
purpose, so there is no failure to count. The abuse being stopped is using
NetLet to post mail into somebody else's inbox.

**There is no social sign-in, on purpose.** It needs a provider configured in
the Firebase console and a redirect the server has to trust; a button that
looks like Google sign-in and does nothing is worse than no button. The
showcase panel carries what the account does, never seller counts or
testimonials — invented numbers on a sign-in wall are checked once and never
trusted again.

## Chrome

`StoreHeader` and `MobileTabBar` are the site's navigation, and every shopping
page uses both. They exist because the cart did not: a shopper could add four
things from a category page and have no way to reach the cart from it. The
drawer is mounted once in `App`, not per page, for the same reason.

Two pages deliberately opt out. Home keeps its own taller header — it carries
the department rail and the hover-to-expand behaviour, which only earn their
place on the page you land on. Checkout keeps a bare one: every extra exit on a
payment page is an invitation to take it.

**Both headers carry the same four controls in the same order**: saved,
language, account, cart. Home's had drifted, which is what two copies do. It
grew an advert for an unpublished app in the spot a shopper looks for their
account — with a QR that decoded to nothing and store buttons that toasted
"soon", the same dishonesty the Publish button and the absent social sign-in are
careful to avoid. It grew a notifications bell that only ever said "coming
soon", which is the browse rule again: a control that changes nothing is worse
than no control. And Saved was stranded in the department rail below, which its
own comment already claimed was "departments only". The app still has its
section further down the home page, where it is an offer rather than a fixture.

The language control names **the language you would get**, not the one you are
reading — `header.language` is "العربية" in the English dictionary and "English"
in the Arabic one. It no longer reads "EN / KWD": there is one currency, and
half a control that cannot change is not a control.

**One label per control, not a caption stacked over a value.** "Your list /
Saved", "Welcome / Sign in" — the caption was always the less informative half,
and four of them meant eight lines of 10px and 12px text across one bar.
Dropping it halves each control, which is what buys the labels their place from
`lg` up: they used to appear only above 1280px, so everything from 1024 to 1280
was four mute circles, and that is the width band most laptops browse at.

**A badge draws only when it has something to say.** A cart badge reading "0"
is an alert that never stops firing, which is the fastest way to teach somebody
to ignore the one place a count matters. Both cart buttons need the guard —
the desktop cluster and the phone-only one beside the logo; the second was
missed on the first pass and still showed a zero.

**Delivery sits at the end of the department rail.** Taking the notifications
bell and the saved icon out of that row left 650px of it empty — more than half
the rail, which read as a fragment rather than a row. Delivery earns the place
those two did not: it is where the parcel goes, it decides what checkout costs,
and it could otherwise only be set from a hero link that scrolls away. Showing
the chosen governorate is information; a bell that said "coming soon" was not.

The search placeholder takes its example **from the live catalog**, and holds
still. It used to cycle four hard-coded phrases every 2.6 seconds — "espresso
maker", "wireless headphones" — naming things the shop may not sell, and moving
in the corner of the eye while somebody is trying to read the page. With no
product type to draw on it asks plainly rather than inventing one.

The bag is server-side, in `carts` and `cart_items`. Its id is a random token
rather than a serial, because it is handed to an anonymous browser and is the
only thing separating one shopper's bag from another's — and every cart query
is scoped by it, so a guessed line id edits nothing. Lines store no price:
a cart is a list of intentions and the price is whatever the variant costs
when the shopper looks. Freezing a price is the order's job.

`useOverlay` is what a drawer, dialog or sheet owes whoever opened it —
Escape closes, focus returns to the opener, the page behind stops scrolling.
Use it for anything modal rather than re-deriving two of the three.

`.tap-target` grows a small control's hit area to 44px through a pseudo-element,
without changing how it looks. Gallery dots are 6px on purpose; a 6px *target*
was a coin toss on a phone.

## Inventory

NetLet owns its catalog. `drizzle/schema.ts` holds vendors, vendor members,
categories, products, variants, images and stock movements, in the Supabase
Postgres that `DATABASE_URL` points at. Money is `numeric`, never a float — the
dinar has three decimal places and a binary fraction cannot hold 24.375.

There is one catalog, not two. The storefront reads the same tables the
admin portal writes: `server/catalog.ts` is the read side,
`shared/commerce/fromInventory.ts` turns rows into the `Product` shape the
pages are written against, and `server/storefront.e2e.test.ts` is what stops
the two drifting apart again — it creates a product through the portal's
procedures and buys it through the shop's.

`shared/commerce/types.ts` is that shape and is the only commerce contract the
client knows. It survived one backend already; keep it free of anything that
smells like a table.

**`shared/inventory/permissions.ts` is the whole access model, and it is pure.**
Two axes: *scope* (a vendor member reaches their own vendor and nothing else,
an admin reaches everything) and *rank* (`staff` moves stock, `manager` runs
the catalog, `owner` runs the team). Some capabilities no vendor rank can
reach at all — commission above all, which the requirements put outside a
vendor's control entirely.

Guards live in `server/inventory.ts`, next to the query each protects, not in
the router alone: a second caller added later would skip a router-level check
silently. `assertCan` throws `FORBIDDEN:<capability>`, which the router
translates into a 403.

There is one router for admins and vendors, not two. Two would mean the same
procedures twice with a different guard at the top of each, which is the
arrangement where a guard eventually goes missing from one copy. Every
procedure resolves *who is asking* and the data layer refuses the rest.

Commission resolves in `shared/inventory/commission.ts`, and a product's own
rate overrides its vendor's. **An explicit zero is an override; an absent value
is not** — "this product earns us nothing" and "this product has no special
rate" are different instructions, and collapsing them loses one of them. Both
rates are admin-only, because commission sits outside a vendor's control
entirely.

`shared/inventory/vendorHealth.ts` is the score and the badges, and both are
pure. The score is four evenly-weighted components rather than a tuned blend,
because the requirement is transparency: every component carries the raw counts
it came from, and those counts are a closed `HealthDetailKey` union so that
adding a figure without a label is a compile error rather than a camelCase
identifier in the middle of an Arabic page. A vendor with nothing yet scores
100 — a new seller has done nothing wrong. `verified` is the one badge no
amount of good behaviour earns: a human checked the documents, and a badge a
seller could earn by behaving well would be saying something else.

A vendor publishing means asking: the product goes to `pending_review` unless
their vendor carries `autoPublish`. Suspending a vendor empties their shelf
without editing a single product, which is what makes suspension a real lever.

## Orders

**A cart stores no prices and an order stores nothing else.** That one sentence
is the whole design. A basket is a list of intentions, so its total moves as the
catalog moves; an order is an obligation, so every number in it is copied at the
moment of sale and never recomputed — not the price, not the product's title,
not the commission rate. Recomputing an old order against today's catalog is how
a refund comes out at a different figure from the payment.

`shared/commerce/order.ts` is the arithmetic and is pure: `freezeLine`,
`draftOrder`, `sliceByVendor`, `refusalFor`. `server/orders.ts` is the part that
needs a database — reading live prices one last time, taking the stock, writing
the order. The split is the same one commission and permissions already use, and
for the same reason: a rule you can only exercise by placing a real order
against a real database is a rule nobody checks.

**Two lifecycles run over one order and conflating them is a classic bug.**
Payment lives on the order (`pending_payment` → `paid` → `cancelled` →
`refunded`); fulfilment lives on the *line*. A basket spanning three vendors can
be fully paid while two of the three have shipped nothing, and partial shipment
within one vendor — two items, one on the shelf — is ordinary. Grouping lines by
vendor gives the per-vendor view without a third table that would then have to
be kept in step with the lines.

Every reference out of `order_items` is `set null` and every fact that matters
is copied beside it. A product can be deleted, a variant renamed, a vendor
removed, and an order from last year still has to render, still has to be
refundable, and still has to say what was bought at what price. The commission
rate is copied for the sharper version of the same reason: raising a vendor's
rate in October must not change what they were owed in September.

Stock is taken with `stock = stock - n WHERE stock >= n`, and that predicate is
the entire safety property — two shoppers racing for the last item both read
"1 available", and without the condition inside the write both are sold it.
A short read is refused rather than corrected: there is no arithmetic that makes
an item appear in a warehouse. Anything already taken is handed back when a
later line cannot be served, so a part-served basket never half-happens.

**The order reference is not the serial id.** `NL-20260915-QRTVW` carries the
date so support can find it without a lookup, and a random tail so a shopper who
orders twice cannot tell how many orders NetLet took in between. The alphabet
drops the characters people mishear — no O or 0, no I, 1 or L, no S or 5 —
because the number gets read down a phone.

Nothing places a *paid* order yet, and that is the honest state rather than an
omission: an order has to exist before a payment can reference it. `orders` and
`order_items` are the shape the payment phase attaches to.

`order_tracking_events` predates this and is now the odd one out — the account
page reads its row count and nothing else. It should be folded into orders when
tracking becomes real.

## Admin portal

`/admin` is one application for admins and vendors both, not two. The pages
are the same pages; scope is already decided by the server, so `products.list`
returns one vendor's rows or every vendor's depending on who asks. Two shells
would mean two navigations showing the same links. It was `/dashboard` until
the rename; `/dashboard/*` still redirects, so old bookmarks land.

Which links appear comes from `can()` — the same pure function the server
guards with. **A hidden link is a courtesy, never a control.** Pass `need` to
`AdminShell` so a route typed into the address bar refuses too: without it,
a manager reaching `/admin/vendors` gets an empty page, which implies the
page exists and has nothing in it rather than that it is not theirs.

Opening a store is one page, `/admin/vendors/new`, and it creates the vendor,
the owner's login and the membership in one call. It exists because the
alternative was three systems: insert a vendor row by hand in the database,
ask the person to register on the storefront, then find them in
`/admin/people` and attach them. `createVendorWithOwner` writes the vendor
first (it is the row that can fail on a duplicate slug) and deletes it again
if the account cannot be made — a store that exists but cannot be signed into
looks finished, so nobody goes back to fix it. The owner is optional: a store
recorded today whose owner arrives next week is a real case.

`server/_core/accounts.ts` is the one place an account gets made, for the
storefront's own registration and for that page alike. The Firebase-or-scrypt
branch used to live inside the auth router, where the second caller would
either import a router or grow a copy — and a copy is how one of them quietly
stops using Firebase.

A store's details are all nullable, and `missingStoreDetails` reports what is
absent rather than the database refusing the save: an admin should not be
blocked from recording a seller because the trade licence is on a document
nobody has scanned. What *is* checked is what would be actively wrong — a
payout IBAN is validated by the mod-97 rule in `shared/inventory/storeProfile.ts`,
because a transposed pair of digits passes any length check and sends money
to an account that does not exist.

`/admin/vendors` is a list and nothing else; one store's status, commission,
badges and team are on `/admin/vendors/:id`, each section saving on its own.
They were all crammed into every row of the list, which made twenty stores a
wall of controls — and one Save across the page writes a commission change
somebody made while fixing a phone number.

A store gains a login two ways, and both cases are real. `people.addToVendor`
attaches somebody who already registered on the storefront; `vendors.addNewMember`
mints the account and attaches it in one call, which is the case an
administrator is usually in — onboarding a shop whose staff have never visited
the site. Without the second, a store that already existed could never gain a
login at all, because the only other path made the store and its owner
together. Both live on the store's own page, under the roles they grant
spelled out rather than only named: a dropdown reading "Staff / Manager /
Owner" asks whoever is choosing to already know the permission model.

An administrator can send any member a reset link from the store's page, which
closes the one hole in the account flows: a vendor who forgot their password
previously needed somebody to open the Firebase console. Unlike the
shopper-facing reset — which is deliberately silent about whether an address
is registered — this one reports what happened, because it takes a user id
the caller already has on screen rather than an address they could be
guessing. It also reports *honestly* when Firebase is unconfigured and no mail
could be sent, since an administrator told "sent" would wait for an email that
was never coming.

Minting an account is `platform.manageUsers`, not `vendor.manageMembers`. An
owner ranks and unranks their own people; creating a NetLet login is a
different act, and an owner who could do it would staff themselves up from
nothing.

**Two grants, deliberately not one control.** `platform.manageUsers` is who
administers NetLet — it clears every vendor, commission, and `/admin/people`
itself. Vendor membership is one company at one rank, and a vendor owner runs
their own team from `/admin/team`. No vendor rank reaches `platform.manageUsers`
at any level, or an owner could promote themselves.

Two moves are refused outright on `/admin/people`: revoking your own
administrator, and removing the last one. Both leave an installation that
needs a database client to recover, and neither is worth allowing to save a
click — there is always another administrator who can do it if it is meant.

**Every admin list is paged, and always says how many there are.** The lists
stopped at a fixed ceiling — 500 products, 100 vendors, 100 people, 50 low-stock
rows — and said nothing, which is the same lie `QueryGate` was built to stop: a
table showing part of the answer looks exactly like one showing all of it.
`shared/pagination.ts` is the arithmetic and is pure; `Pager` draws it. The
count is rendered even on a single page, because the count is the part that
keeps a short list honest.

Two things follow from paging that are easy to get wrong, and both are tested.
**Filtering moved to the server** — product search and the review queue's
`pending_review` filter — because a filter applied to the rows already fetched
searches one page and reports "no matches" for something on another. And
**every paged query ends on a unique column**: `updatedAt` is not unique, a bulk
import gives a hundred rows the same microsecond, and Postgres orders ties
freely between two queries, so offset paging over an unstable sort repeats rows
on the next page and skips others. That one was found in the browser, not in a
test — the fixtures were too small to tie.

**Every admin page has three states, not two.** `QueryGate` renders loading,
failed, or ready; a failed query shows what the server actually said and
offers to retry. Before it, every page branched on `isLoading` and then read
`data ?? []`, so a refused or broken query rendered as "No vendors yet" — the
worst of the three answers, because an empty table reads as working and
invites somebody to add the thing that is already there and merely unreadable.
The server's own message is shown deliberately: "column contact_email does not
exist" tells an administrator to run the migration, and "something went wrong"
does not.

`/admin` opens on counts rather than lists, because the first question on
arriving is "is anything waiting for me". "Waiting on you" carries only what
somebody must act on and hides a zero; standing totals sit below it. Every
tile links to the page that acts on it — a count with nowhere to go is
decoration.

`/admin/stock` judges low against **each variant's own `lowStockAt`**, not one
shared number: three left of something that reorders at two is fine, three
left of something that reorders at twenty is the emergency, and sorting by
raw count puts them the wrong way round. A variant with no threshold is only
listed once it hits zero.

**Publishing requires a price, and that is a money rule rather than a tidiness
one.** `createProduct` starts every product with a "Default" variant at 0.000,
because a product with no variant cannot be priced or bought at all — and the
cost of that convenience was that pressing Publish before typing a price put
the thing in the shop at KWD 0, buyable for nothing. `assertPriced` now blocks
it on both doors onto the shelf: `setProductStatus` and an admin approving
from the review queue. Any variant at zero blocks, not merely all of them,
since the zero one is buyable at zero the moment the product is live.

The publish button says what will actually happen. A vendor without
`autoPublish` pressing Publish sends the product for review, and the page says
so — a button labelled "Publish" that quietly produces "In review" is the kind
of small dishonesty that makes people distrust a tool.

Stock moves by a delta with a reason, never by typing a new total. "We received
12" is what happened; setting the box to 47 loses why and races with whoever
else is editing. `/admin/stock` is what reads those rows back, which is the
whole reason for recording them.

In a demo build the portal opens against fixtures as a vendor `manager` —
the one place the storefront's signed-out-guest rule is bent, because a sign-in
wall would show nothing of the thing being demonstrated. `/admin/people` is
admin-only, so in the demo it correctly refuses.

## Colour and contrast

**The brand orange is a fill, not an ink.** `#f2683a` on a pale surface
measures 3.08:1 against white — below the 4.5:1 that normal text needs, and
it was being used for links, eyebrows and hints all over the storefront.
Three utilities in `index.css` are what it becomes when it has to be read:
`.ink-accent` (`#a44a2b`, 5.84:1 — already the codebase's darker orange, so no
new hue), `.ink-accent-on-dark` (`#ffab85`, for the same text over navy, where
darkening would make it worse), and `.ink-muted` (`#536b8c`, replacing
`#778ba6` at 3.48 and `#7e859b` at 3.67).

Use those rather than a raw hex for anything that is words. The fills are
untouched: orange is still orange everywhere it is a surface.

Variants cannot be stacked on these: write `hover:text-[#a44a2b]`, not
`hover:ink-accent`, which resolves to nothing at all.

`axe-core` over the storefront and the portal in both languages is what found
all of it. **Run it against a catalog with products in it** — an empty shop
never renders a product card, and half of these only appeared once there was
something on the shelf.

Three violations remain, all the same one: **white on `#f2683a` is 3.08:1**, on
the home page's orange hero card. That is the brand decision this file already
flags under Buttons — reaching AA needs a darker orange than the brand's, and
that is a call for the brand rather than something to fix by quietly changing
the colour. Everything around it has been taken as far as it goes without
touching the hue.

## Browsing

`/category/:slug` is the department page — the sidebar, the grid, the sort.
Clicking a department anywhere on the site goes there; the home page is a
shopfront of curated rails, not a filtering surface, so it holds no "active
category" of its own.

`shared/commerce/browse.ts` is all of the logic and is pure: `facetsFor`
derives the filters **from the products on the page**, so a catalog of laptops
gets a Ram Size filter and one of shoes does not — nothing is hard-coded. A
facet that cannot narrow is dropped (one brand, one option value, a rating
threshold matching everything), because a control that changes nothing is worse
than no control.

**Filters live in the query string, never in state alone.** A narrowed list is
something shoppers bookmark and send each other, so the URL is the single
source of truth and the page reads back from it. Option facets are namespaced
`opt.<name>` so a merchant option called "sort" cannot collide.

Slugs are lossy on purpose — "Home & Kitchen" becomes `home-and-kitchen` — and
`categoryFromSlug` resolves them back against the live catalog rather than
trying to invert them. An unrecognised slug falls back to the whole catalog,
never to an empty page.

## Languages

The storefront ships in English and Arabic, from one dictionary in
`shared/i18n/dictionary.ts`. `ar` is typed as a complete record of the English
keys, so a missing translation is a type error rather than an English word
appearing mid-Arabic-sentence; `shared/i18n/dictionary.test.ts` also fails on an
Arabic entry that is still a copy of the English, or that has drifted from its
`{placeholder}` set.

Two rules keep the RTL layout honest:

- **No physical direction utilities in page code.** `ms-`/`me-`/`ps-`/`pe-`/
  `start-`/`end-`/`text-start`/`border-s`. `left-1/2 -translate-x-1/2` is the
  exception — it centres, it does not take a side.
- **Arrows and chevrons that mean "onward" carry `rtl:-scale-x-100`.** So do
  the gradients and masks that shade toward the text, or the Arabic headline
  ends up sitting on the bright side of the hero.

**A stored language is `null` until the shopper picks one, and that is load
bearing.** `customer_preferences.locale` is nullable rather than defaulting to
`en`, because a row gets created the first time somebody sets a delivery zone
or their bag syncs — and a `NOT NULL DEFAULT 'en'` stamped "English" onto
people who had said nothing. The client then adopted it, so signing in while
reading Arabic flipped the whole site to English and left `localStorage`
disagreeing with the page. Now: no stored preference means the language in use
is kept *and written up*, and a stored one still wins, so a real choice
follows the shopper between devices.

Merchant data (product titles, spec rows) is in whatever language the merchant
typed. Specification rows and description text carry `dir="auto"` so each takes
its own direction and the punctuation lands on the right side.

**A value that is always Latin gets `<bdi dir="ltr">`, never `dir` on the block
around it.** An email, a slug, a score, a URL path: the characters read left to
right, but the *line* is still part of an Arabic page and belongs on its side.
`dir` on a block does both jobs, so `<p dir="ltr">` threw the address to the far
edge with the label above it hugging the other one — visible on the account
card, `/admin/people`, `/admin/team` and a store's header. `client/src/lib/markup.test.ts`
is what keeps it out, allowing `dir="ltr"` only on a form control (where it sets
the typing direction), an inline run, or `pre`.

That rule is about values, not prose: on merchant text `dir="auto"` flipping the
whole block is the intent, which is why the guard polices `ltr` and leaves
`auto` alone.

## Images

**A picture that fails is never a broken icon.** `Thumb` draws every merchant
image in the storefront, and on `error` it swaps to a fallback. That is not an
edge case here: until uploads exist these are URLs a vendor typed, so a dead
link is an ordinary state, and the browser's own broken-image glyph on a white
ground makes one seller's typo look like the whole site is down. Every `<img>`
handled the *absent* case already and none handled the *failing* one.

It stores which `src` failed rather than a boolean, so a swatch that swaps the
photo is not stuck showing the fallback for a picture that is fine. The
fallback's surface is the caller's to choose — the department tiles carry a
colour each, and a neutral box painted over it costs them the only thing that
distinguishes them.

**Every `<img>` says how it loads**, and `markup.test.ts` fails on one that does
not. There was a single `loading="lazy"` in the whole storefront, so a category
page opened every product photo at once — worst exactly where NetLet sells, on
a phone on a Kuwaiti mobile connection.

The attribute has to be present; which value is a judgement about the page, and
the test deliberately does not have an opinion. Three of them are `eager`: the
home hero and the product page's own picture, both `fetchPriority="high"`
because they are that page's largest paint, and the header logo, eager but
*without* the priority hint so it does not compete with them. Everything else —
cards, rails, thumbnails, the bag drawer, the admin editor — is `lazy`.

`decoding="async"` rides along everywhere: decoding a photo on the main thread
blocks the frame, and nothing here needs an image decoded synchronously.

Sizes are not set as attributes because every image already sits in a box the
CSS fixes (`aspect-square`, `aspect-[1.02]`, `size-*`), which is what actually
prevents the layout shifting. `product_images` stores no dimensions to set them
from anyway.

Both guards in `markup.test.ts` read the source with its comments stripped. This
codebase explains itself at length — `Thumb` describes the broken-image case in
prose containing a literal `<img>`, and half the files discuss `dir="ltr"` by
name — and a guard that reports its own documentation trains everybody to ignore
it. The image scan also tracks brace depth rather than matching to the first
`>`, because `onError={() => reset()}` contains one.

## Deploys

`server/_core/app.ts` holds the routes and the security, and knows nothing
about how it is served. Two entry points use it: `server/_core/index.ts` adds
Vite or static files and listens on a port, `api/index.ts` exports it as a
Vercel function. One copy of the routes, so the two cannot drift.

Vercel is the target that can run the backend — `docs/VERCEL.md` is the setup,
and environment variables live in its dashboard rather than a `.env`. The app
normalises a `/trpc/…` path back to `/api/trpc/…`, because a platform that
rewrites onto a function mounted at `/api` may hand over the rewritten path,
and every call would otherwise 404 silently.

**The Vercel function is bundled, not transpiled.** `api/index.ts` is a
two-line stub that re-exports `api/app.generated.js`, which
`scripts/build-function.mjs` produces from `server/_core/vercel.ts` with every
dependency inlined. The stub exists because Vercel detects a function from a
committed file in `api/`; the bundle exists because everything else about
Vercel's own handling was a trap.

Left to transpile, the function is a tree of loose files run as plain Node
ESM, and three separate things broke there while `pnpm check`, `pnpm test` and
`pnpm build` all passed — because Vite, esbuild, vitest and tsx each resolve
what plain Node does not:

- tsconfig path aliases (`@shared/x`) went unresolved;
- extensionless relative imports (`./app`) are not valid ESM specifiers;
- `jwks-rsa`, CommonJS and reached through `firebase-admin`, could not
  `require()` the ESM-only `jose` on a Node older than 22.12.

Bundled, esbuild settles all three before the code leaves this machine. The
bundle carries a `createRequire` banner because CommonJS packages still reach
for `require` and `__dirname` once inside an ESM file — dotenv asking for `fs`
is the first thing to hit it, and it fails on the first request rather than at
load, so "it boots" is not evidence.

`server/_core/imports.test.ts` still enforces no aliases and explicit `.js`
extensions across `server/`, `shared/`, `api/` and `drizzle/`. Bundling means
neither can break the deploy any more, but both keep `tsx` and a plain `node`
run honest, and the rules cost nothing.

Verify a change to any of this the only way that means anything: build, then
serve the bundle from a directory with **no `node_modules`**, and hit
`/healthz` and a tRPC route. Anything less agrees with itself and not with
Vercel.

`pnpm smoke` is that check, and CI runs it on every push. It copies
`api/app.generated.js` to a temp directory *outside the repository* — Node
resolves `node_modules` by walking up, so a scratch folder inside the project
would quietly find the project's own dependencies and pass a bundle missing
half of itself — and asks for a real response rather than settling for a
process that started. `/healthz` is answered before the router is ever
touched, so a bundle whose router cannot load still passes it; the tRPC route
is the check that matters.

### robots.txt and sitemap.xml

Both are generated by the app, not committed. As files they had gone stale the
way files do: `robots.txt` pointed crawlers at a sitemap that had never existed,
on a host spelled with a repository name the project had already renamed away
from. `shared/sitemap.ts` is the pure serialiser and `server/sitemap.ts` reads
the catalog — through `publishedCatalog`, so a draft or a suspended vendor's
product is absent from the index for the same reason it is absent from the shop.

The origin is never written down. `SITE_URL` wins when a canonical domain has
been decided; otherwise it is the origin that answered the request, which is
right on a preview deployment and on a laptop with nothing to configure.

### GitHub Pages

Pages serves `main` at `/` — "Deploy from a branch", one branch only. The
workflow builds and commits the result back into `main`, so its deploy commits
land on the branch you are working on: expect to rebase.

Two traps:

- The base path is derived from the repository name at build time. A rename
  moves the Pages URL, and a build carrying the old name loads to a blank page.
- The deploy commit carries a skip-ci marker. Do not write that marker verbatim
  in an ordinary commit message — GitHub matches it anywhere in the message and
  will skip the build.

## Demo mode

`VITE_DEMO_MODE=true` builds a version with no backend: `client/src/lib/demoLink.ts`
answers every tRPC procedure from fixtures in `demoCatalog.ts`. That is what the
Pages site runs. **The catalog is invented** — sample products and prices, with
nothing on the page saying so since the preview banner was removed.

## iOS app

`ios-app/` is the whole iOS side: the Expo source, the artwork, and the
generated Xcode project in `ios-app/ios/`, which is committed so it opens from
a clone. It is a WebView shell around the published Pages site, so it needs no
backend running.

`ios/` is generated from `app.json` by `npx expo prebuild` — hand edits to the
Xcode project are lost the next time that runs. `ios-app/README.md` has the
run steps and what is deliberately not committed.

Expo Go cannot run it: three of its modules ship native code. `npx expo run:ios`
is the way in.

## Checks

`pnpm check` · `pnpm test` · `pnpm build` · `pnpm smoke`.

**CI runs all four on every push**, from `.github/workflows/ci.yml`. There was
none for a long time, which was survivable while the work was the storefront
and stopped being survivable once orders and payments arrived: a silent
regression there is money rather than a layout bug. The fourth is the one the
other three cannot replace — `check`, `test` and `build` all run through
tooling that resolves imports more generously than plain Node, and all three
have passed green on a function that could not boot. A fresh database needs
`pnpm db:push` then `pnpm db:seed` — the seed writes the departments and the
house vendor and nothing else, because a product cannot exist without a vendor
to own it, and an invented catalog on a real deployment looks like an open
shop. `docs/supabase-bootstrap.sql` is those two steps as one paste-able file,
for setting a database up from the Supabase dashboard with nothing installed;
`node scripts/build-bootstrap.mjs` regenerates it from `drizzle/*.sql` and
`shared/commerce/departments.ts` — run that after a schema change rather than
hand-editing, which is how it ended up two migrations behind.

**Its output is idempotent, and that is the point.** As plain migrations it
only worked on an empty database, so a database that was behind needed
somebody to work out *which* migrations it had missed and paste exactly
those — a diagnosis, by hand, at the moment something is already broken. With
`IF NOT EXISTS` everywhere (and a `DO` block where Postgres offers no such
clause, or for the one `RENAME COLUMN`, which is the only statement that is
actively not re-runnable), the answer to "my database is behind" is always
"run this file", and running it on a current database does nothing. The
generator exits non-zero on a statement shape it cannot make idempotent,
because a file that claims to be re-runnable and is not is worse than one
that never claimed it. `docs/SUPABASE.md`
is the walkthrough. Data-layer tests run against a real
Postgres in-process via PGlite, applying the generated migration verbatim, so
`ON CONFLICT` arbiters and enum types are genuinely exercised.

Configuration lives in `.env.example`, annotated with what each value switches
off — nothing throws at boot, so a missing value shows up as a dead feature.
`pnpm setup:env` writes the `.env` from it; given the Firebase service-account
JSON it also writes the three values whose escaping is the usual failure.
`pnpm preflight` then says what is still missing, by name.
