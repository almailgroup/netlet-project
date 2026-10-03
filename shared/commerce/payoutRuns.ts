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
  orderId: number;
  reference: string;
  /** Positive pays the seller; negative takes back a refund already paid out. */
  amountFils: bigint;
  kind: "payout" | "clawback";
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
export function batchFor(obligations: Obligation[], paidFils: ReadonlyMap<number, bigint>): Batch {
  const lines: BatchLine[] = [];
  for (const obligation of [...obligations].sort((a, b) => a.orderId - b.orderId)) {
    const outstanding = obligation.earnedFils - (paidFils.get(obligation.orderId) ?? 0n);
    if (outstanding > 0n && obligation.due.state === "due") {
      lines.push({ orderId: obligation.orderId, reference: obligation.reference, amountFils: outstanding, kind: "payout" });
    } else if (outstanding < 0n) {
      lines.push({ orderId: obligation.orderId, reference: obligation.reference, amountFils: outstanding, kind: "clawback" });
    }
  }
  const totalFils = lines.reduce((sum, line) => sum + line.amountFils, 0n);
  return { lines, totalFils, payable: totalFils > 0n };
}

/** An IBAN as a seller sees their own on a shared screen: the country and the last four. */
export function maskIban(iban: string | null): string | null {
  if (!iban) return null;
  const compact = iban.replace(/\s+/g, "");
  return compact.length <= 6 ? compact : `${compact.slice(0, 2)}•••• ${compact.slice(-4)}`;
}

/** The longest bank reference a run records. */
export const MAX_BANK_REFERENCE = 80;
