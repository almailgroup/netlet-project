/**
 * Damage in transit, and who bears it (3.4.2).
 *
 * Pure, for the reason the order arithmetic is: an accepted claim is money a
 * delivery company owes, and a rule that decides money is a rule worth being
 * able to check without a van.
 *
 * ## Who may claim, and when
 *
 * **Only a parcel somebody else carried.** A claim is against a delivery
 * company, so a parcel with no company assigned — a seller delivering their own
 * goods — has nobody to bear it, and is refused with that reason rather than
 * filed against nobody.
 *
 * **Only once it left the seller.** Damage before collection is the seller's
 * own shelf; a claim needs the parcel to have been `shipped` at least.
 *
 * **The shopper claims after arrival, within a short window.** Damage is found
 * on unpacking, and a claim filed a month later is no longer evidence of how a
 * box was carried. A seller or an administrator may also claim while the parcel
 * is still out — a driver ringing to say the van was in an accident is the case.
 *
 * ## What a claim may be worth
 *
 * **At most what the damaged lines were sold for**, read from the frozen
 * `lineTotal`s and never from the caller. Delivery fees are not part of it:
 * the claim is for the goods, and a refund of postage is a separate argument
 * with a separate party. An administrator may award less than was claimed — a
 * scratched leg is not a whole sofa — and never more.
 *
 * ## The decision
 *
 * `open` → `accepted` or `rejected`, once. A decided claim is a fact about a
 * company's record and is not reopened; a parcel can be claimed again, which
 * is what new evidence calls for, and the partial unique index allows exactly
 * one open claim at a time.
 *
 * **A line that has been paid for is not claimable again.** "Claim again with
 * new evidence" is the answer to a *rejection*; after an acceptance it would
 * be the same cushion compensated twice. Found by looking at the shopper's
 * page after an award, where "Report damage" was still on offer.
 */
import { fromFils, toFils } from "../money.js";

/** Days after arrival a shopper may still claim. */
export const CLAIM_WINDOW_DAYS = 7;
export const MAX_CLAIM_DESCRIPTION = 2000;
export const MAX_CLAIM_RESPONSE = 2000;

export const CLAIM_STATUSES = ["open", "accepted", "rejected"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Who saw the damage. It weighs on the decision, so it is recorded. */
export const CLAIM_FILERS = ["shopper", "seller", "admin"] as const;
export type ClaimFiler = (typeof CLAIM_FILERS)[number];

export type ClaimRefusal =
  | "claims.noCourier"
  | "claims.notCarried"
  | "claims.notArrived"
  | "claims.windowClosed"
  | "claims.noLines"
  | "claims.notInParcel"
  | "claims.badAmount"
  | "claims.overValue"
  | "claims.needsDescription"
  | "claims.badEvidence"
  | "claims.alreadyOpen"
  | "claims.alreadyPaid"
  | "claims.notOpen";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ClaimableParcel = {
  courierId: number | null;
  /** The parcel's least advanced line, as the board reads it. */
  state: string;
  /** When the last line arrived, or null while any has not. */
  arrivedAt: Date | null;
};

/** Whether this filer may claim on this parcel now, and the reason if not. */
export function claimRefusal(parcel: ClaimableParcel, filer: ClaimFiler, now: Date): ClaimRefusal | null {
  if (parcel.courierId === null) return "claims.noCourier";
  if (parcel.state !== "shipped" && parcel.state !== "delivered") return "claims.notCarried";

  if (filer === "shopper") {
    if (!parcel.arrivedAt) return "claims.notArrived";
  }
  if (parcel.arrivedAt && now.getTime() > parcel.arrivedAt.getTime() + CLAIM_WINDOW_DAYS * DAY_MS) {
    /* The window binds an administrator too: a claim filed weeks on is not
       evidence of how a box was carried, whoever files it. */
    return "claims.windowClosed";
  }
  return null;
}

/** The most a claim on these lines may be for: what they were sold for. */
export function claimCeiling(lines: { lineTotal: string }[]): string {
  return fromFils(lines.reduce((sum, line) => sum + toFils(line.lineTotal), 0n));
}

const AMOUNT = /^\d{1,9}(\.\d{1,3})?$/;

/**
 * Whether an amount is a positive sum of money no larger than the ceiling.
 * Returned as a refusal so the page can name which.
 */
export function amountRefusal(amount: string, ceiling: string): ClaimRefusal | null {
  if (!AMOUNT.test(amount) || toFils(amount) <= 0n) return "claims.badAmount";
  if (toFils(amount) > toFils(ceiling)) return "claims.overValue";
  return null;
}

/**
 * An evidence link, or a refusal. Https only: a plain http photograph link is
 * one somebody in between could swap, and this is evidence about money.
 */
export function evidenceRefusal(url: string | null | undefined): ClaimRefusal | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? null : "claims.badEvidence";
  } catch {
    return "claims.badEvidence";
  }
}

/** The lines an accepted claim already compensated: never claimable again. */
export function paidLineIds(claims: { status: string; lineIds: number[] | null }[]): Set<number> {
  const paid = new Set<number>();
  for (const claim of claims) {
    if (claim.status === "accepted") for (const id of claim.lineIds ?? []) paid.add(id);
  }
  return paid;
}

/** Whether the company may still answer, and the admin still decide. */
export function isOpen(status: string): boolean {
  return status === "open";
}

export type ClaimForLedger = { courierId: number | null; status: string; awardedAmount: string | null };

/**
 * What each company owes for damage: the sum of its accepted awards.
 *
 * Open claims are counted apart rather than in the total — a liability nobody
 * has decided is not one — and rejected claims are counted so a company with
 * many rejected claims is visible as the other kind of pattern.
 */
export function liabilityByCourier(claims: ClaimForLedger[]) {
  const ledger = new Map<number, { courierId: number; owed: bigint; accepted: number; open: number; rejected: number }>();
  for (const claim of claims) {
    if (claim.courierId === null) continue;
    const row = ledger.get(claim.courierId) ?? { courierId: claim.courierId, owed: 0n, accepted: 0, open: 0, rejected: 0 };
    if (claim.status === "accepted") {
      row.accepted += 1;
      row.owed += toFils(claim.awardedAmount ?? "0");
    } else if (claim.status === "open") {
      row.open += 1;
    } else if (claim.status === "rejected") {
      row.rejected += 1;
    }
    ledger.set(claim.courierId, row);
  }
  return [...ledger.values()]
    .map(row => ({ ...row, owed: fromFils(row.owed) }))
    .sort((a, b) => a.courierId - b.courierId);
}
