/**
 * Payout runs (3.3.21): what NetLet pays each seller, batched by the schedule
 * and recorded once.
 *
 * Pure, because what it decides is money moving from NetLet to a seller — the
 * reason the order arithmetic is pure.
 *
 * ## The batch assembles itself
 *
 * Nobody chooses which orders go in a payout. `payoutSchedule.ts` already says
 * when each order's money is due — fourteen business days after a driver
 * collected the cash, one to three for anything else — so a seller's batch is
 * every order whose due date has come and whose money has not been paid. The
 * one human act left is the transfer itself, and recording it with the bank's
 * reference, because NetLet has no rail that moves money on its own (3.2.1).
 *
 * ## A payout is a fact; what is owed is recomputed against it
 *
 * Each order earns its seller the frozen `vendorNet` of the lines that stuck.
 * What a run pays for that order is recorded, so what is *outstanding* is
 * always earned minus paid. That one subtraction is the whole of the clawback:
 * a line refunded after its money went out drops what the order earned below
 * what was paid, and the difference comes off the seller's next batch as a
 * negative line — which is what `docs/REQUIREMENTS.md` said would be needed
 * the day payout runs were recorded, and the reason the weekly report could
 * never show a week below zero until there was something to reverse against.
 *
 * A placement fee (3.3.15) comes off the same way: whatever a booking has
 * accrued and no run has yet taken is a negative line, `kind: "fee"`, and
 * like a clawback it never waits for a due date — it is already owed.
 *
 * A batch whose clawbacks outweigh what is due is not paid. Nothing is sent,
 * the debt carries to the next batch, and the page says how much NetLet is
 * owed rather than inventing a negative transfer.
 */
import type { PayoutDue } from "./payoutSchedule.js";

/** One order's obligation to one seller, as the schedule sees it. */
export type Obligation = {
  orderId: number;
  reference: string;
  /** The frozen vendor net of the lines that stuck, in fils. Zero once refunded. */
  earnedFils: bigint;
  due: PayoutDue;
};

export type BatchLine = {
  /** The order the line settles, or null on a placement fee. */
  orderId: number | null;
  /** The placement a fee line charges for, or null on an order's line. */
  bookingId: number | null;
  /** The packing charge a fee line takes (4.2), or null. */
  chargeId: number | null;
  reference: string;
  /** Positive pays the seller; negative takes back a refund already paid out, or a fee. */
  amountFils: bigint;
  kind: "payout" | "clawback" | "fee";
};

/**
 * One fee as the ledger sees it: a placement's (3.3.15), which accrues by the
 * day, or NetLet's packing charge (4.2), which is whole the moment it is made.
 * Exactly one of the two ids is set.
 */
export type FeeCharge = {
  bookingId?: number | null;
  chargeId?: number | null;
  /** `AD-<id>` or `FF-<id>`, which is what the run records in place of an order reference. */
  reference: string;
  /** What it has cost so far, in fils, per `feeAccrued`. */
  accruedFils: bigint;
  /** What runs have already taken for it, stored negative. */
  deductedFils: bigint;
};

export type Batch = {
  lines: BatchLine[];
  totalFils: bigint;
  /** Whether there is anything to send: a positive total. */
  payable: boolean;
};

/**
 * The seller's next batch, from their obligations and what each order has
 * already been paid.
 *
 * Money not yet due waits even when it is outstanding — a fourteen-day hold
 * exists because cash can still come back — but money owed *back* never
 * waits: a refund is already a fact, and carrying it would pay out money the
 * seller no longer earned.
 */
export function batchFor(obligations: Obligation[], paidFils: ReadonlyMap<number, bigint>, fees: FeeCharge[] = []): Batch {
  const lines: BatchLine[] = [];
  for (const obligation of [...obligations].sort((a, b) => a.orderId - b.orderId)) {
    const outstanding = obligation.earnedFils - (paidFils.get(obligation.orderId) ?? 0n);
    if (outstanding > 0n && obligation.due.state === "due") {
      lines.push({ orderId: obligation.orderId, bookingId: null, chargeId: null, reference: obligation.reference, amountFils: outstanding, kind: "payout" });
    } else if (outstanding < 0n) {
      lines.push({ orderId: obligation.orderId, bookingId: null, chargeId: null, reference: obligation.reference, amountFils: outstanding, kind: "clawback" });
    }
  }
  /* Placements first, then packing charges, each by id, so a batch reads the same every time it is drawn. */
  const order = (fee: FeeCharge) => (fee.bookingId != null ? [0, fee.bookingId] : [1, fee.chargeId ?? 0]);
  for (const fee of [...fees].sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1])) {
    /* `deducted` is negative, so this is accrued less what was already taken. */
    const owed = fee.accruedFils + fee.deductedFils;
    if (owed > 0n) lines.push({ orderId: null, bookingId: fee.bookingId ?? null, chargeId: fee.chargeId ?? null, reference: fee.reference, amountFils: -owed, kind: "fee" });
  }
  const totalFils = lines.reduce((sum, line) => sum + line.amountFils, 0n);
  return { lines, totalFils, payable: totalFils > 0n };
}

/** What a placement fee is called on a payout: `AD-12`. */
export function feeReference(bookingId: number): string {
  return `AD-${bookingId}`;
}

/** What a packing charge is called on a payout: `FF-12`. */
export function chargeReference(chargeId: number): string {
  return `FF-${chargeId}`;
}

/** An IBAN as a seller sees their own on a shared screen: the country and the last four. */
export function maskIban(iban: string | null): string | null {
  if (!iban) return null;
  const compact = iban.replace(/\s+/g, "");
  return compact.length <= 6 ? compact : `${compact.slice(0, 2)}•••• ${compact.slice(-4)}`;
}

/** The longest bank reference a run records. */
export const MAX_BANK_REFERENCE = 80;
