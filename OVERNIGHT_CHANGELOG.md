# Overnight changelog

Autonomous work through the night of 18–19 November 2026, until 08:00 in
Kuwait (05:00 UTC). Every change here was checked with `pnpm check`, the
whole `pnpm test`, `pnpm build` and `pnpm smoke` before it was pushed to
`main`, and each fix carries a test that fails without it. No migrations:
those wait for the owner.

## Cycle 1 — 21:20 UTC

### Audits run

- **API sweep** (`.scratch/sweep.mts`, every tRPC procedure with inputs
  built from its own schema): 453 procedures as a guest, a shopper, a
  store's owner, a full administrator, and a member of each of the seven
  ready-made NetLet team roles. **No 500s and no database sentences**.
- **Role diff**: for each team role, every procedure it reached that a
  shopper did not. HR reached Team and nothing else. Two leaks came out
  of the rest (below).
- **Build warnings**: one, the main chunk's size, which CLAUDE.md
  already accounts for.

### Fixed

1. **Team roles could read every store's bank IBAN.** `stores.view` is
   in five areas, and `inventory.vendors.get` / `.list` sent the whole
   store row. The payout IBAN is now masked (`KW•••• 0101`) for any role
   that neither edits nor pays the store; Finance and the Stores area
   still see it whole. Test: `team.test.ts`, "shows a store's payout
   account whole only to a role that edits or pays the store" (fails
   without the fix).
2. **The store page offered a read-only role Saves the server refuses**,
   and two error cards (Store documents, the team). Each section now
   asks the capability its own save asks, on the website
   (`VendorDetail.tsx`) and in the app (`PortalStoreView`). The company
   list is asked for only with `delivery.view`. Walked as Marketing,
   Finance and a full administrator at 320, 390 and 1440 in both
   languages: no Save for Marketing, Finance's one (commission), the
   administrator's six, axe clean, no sideways scroll (a nested
   fieldset's `min-content` width was found and fixed at 320).
3. **Removed `adminProcedure`**, unused, and since the team split a
   door every role would pass, plus two unused constants.

4. **The Bundles page could not load for Finance, Operations or
   Marketing**: the menu offers it by `product.view`, the list asked
   `bundles.netlet`. Listing reads by `product.view`; the form and the
   Take off buttons show only to who may save. Test: `team.test.ts`.
5. **The product editor offered Catalogue a commission proposal**, a
   store's own ask of NetLet, whose list then refused. Drawn for a
   store's people only.
6. Re-swept the admin portal signed in as all six team roles: **0
   findings**.

The app's half of 4 and 5 waits in a stash until iOS run 292 and its
TestFlight upload finish, since a push to `Frontend/iOS` would cancel it.

## Cycle 2 — 22:00 UTC

### Visual pass on the website (the owner's ask), desktop and phone

Pictures of every shopping page at 320, 390 and 1440 in both languages,
read one by one. What was wrong, and what it is now:

7. **A lone sponsored product stretched the width of a phone.** The rail's
   item had a minimum width and no maximum, so one card filled the row. A
   card is a card's width now (164px, 195 from `sm`), as in every shelf.
8. **The product page's "Share and earn points" was cramped on a phone**:
   the coin, two lines and the Share button in one row left the words a
   narrow column. The button goes under the words when the card is narrow
   (a container query, so it answers the card's width), and stays beside
   them on a computer.
9. **The bag and checkout said "KWD 0.000" for free delivery.** Both
   summaries say "Free", in green, as the store rows above them already did.
10. **Checkout's Place order broke over three lines at 320** — "Place",
    "order", then the dot alone and the total. The total is said just above
    it, so on a card too narrow for both the button keeps its words on one
    line and the total is left out (`@container` on the summary).
11. **The account's "Your store" and affiliate cards were a column one word
    wide at 320** ("Switch / to / the / seller / portal"). Their button goes
    under the words when the card is narrow, as the share card's does.
12. **A search box's example was cut mid-word at 320** ("Search categories
    and store"). The field ends it with an ellipsis instead.

Each was measured after the fix at 320, 360, 390 and 1440 in both
languages (`.scratch/visual-check.mjs`): the button's words on one line, the
cards' words at full width, no sideways scroll.

Two more wait for the dictionary, which the iOS run must finish before it
can change: a card with no photo says "Image processing" (nothing is being
processed; it should draw the bag that every other missing photo draws),
and the home page's app section carries an eyebrow and a slogan as its
heading, which CLAUDE.md asks against.

### Static audit

13. **No guard reads the role where it should read a capability**: every
    `role === "admin"` left in the server decides something other than
    access (the owner's account, device trust, error detail, the trail).
14. **Twenty unused exports removed** — database helpers nothing called
    (`courierFor`, `paymentsForOrder`, `markLineDelivered`, `settingValues`),
    one whose comment claimed callers it did not have
    (`supabaseConfirmsEmailItself`, "asked by `pnpm preflight`"), test
    helpers no test used, and four money and parcel helpers.
15. **Ten unused imports and locals removed**, and `noUnusedLocals` turned on
    in `tsconfig.json`, so `pnpm check` refuses the next one.
16. Re-ran the browser sweep of the shop and the account as a guest and a
    shopper at 390 and 320 in both languages and at 1440 in Arabic: **0
    findings**.

### Queued

- Push the app's half of 4 and 5 once TestFlight 292 is up.
- The two dictionary-touching visual fixes above, after the same run.
