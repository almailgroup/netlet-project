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

### Queued

- Browser sweep of the shop, account and portal (all roles, 320 / 390 /
  1440, both languages) on a production build.
- Static audit: procedures whose guard reads the role rather than a
  capability; dead exports.
