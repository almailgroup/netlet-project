/**
 * How a shopper pays, starting with the one way that needs nobody's approval.
 *
 * Requirement 3.2.2: cash on delivery, on by default, and a seller may turn it
 * off. Pure, because it decides whether an order can be placed at all and
 * because the ceiling below is money.
 *
 * ## What this is and is not
 *
 * **Cash on delivery is not a payment integration**, which is why it is here
 * while KNET, cards and BNPL (3.2.1) are not. Nothing is authorised, captured
 * or settled: the shopper agrees to hand money to a driver, and the order
 * stays `pending_payment` until somebody records that it happened. Marking it
 * `paid` at checkout would be recording a payment that has not occurred.
 *
 * **A basket is one payment, so one refusing seller refuses the basket.**
 * There is no way to pay two sellers two ways in one order, and quietly
 * dropping the seller who said no would be editing somebody's basket to make
 * a button work.
 *
 * **On by default, because that is what the requirement says** — a seller has
 * to opt *out*. A new store that has recorded nothing can still be bought
 * from, which is the direction every other default in this codebase takes.
 *
 * **There is a ceiling, and it is the seller's risk rather than ours.** A
 * driver carrying a thousand dinars in cash is a different proposition from
 * one carrying twenty. Absent means no ceiling, which is the honest reading of
 * a seller who has not thought about it.
 */
import { compareMoney, toFils } from "../money.js";

/** What NetLet can actually take today. The rest wait on 3.2.1. */
export const PAYMENT_METHODS = ["cod"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** One seller's stance, as the store's page records it. */
export type CodRule = {
  /** Off only if the seller said so. Absent is on. */
  accepts: boolean;
  /** The most they will send a driver to collect. Null: no ceiling. */
  ceiling: string | null;
};

export const COD_DEFAULT: CodRule = { accepts: true, ceiling: null };

/** Why cash on delivery is not available, when it is not. */
export type CodRefusal =
  /** NetLet has switched cash off for the whole shop (2.3, 3.2.2). The name is
     empty: no seller is why, and an app that reads a name keeps decoding. */
  | { kind: "shop"; vendorName: "" }
  /** At least one seller in the basket does not take it. */
  | { kind: "seller"; vendorName: string }
  /** The basket is over a seller's ceiling. */
  | { kind: "ceiling"; vendorName: string; ceiling: string };

/** One seller's share of the basket, as the caller already grouped it. */
export type CodGroup = { vendorName: string; goods: string; rule: CodRule };

function amount(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  return toFils(text);
}

/**
 * May this basket be paid in cash on delivery?
 *
 * Returns the *first* reason it may not rather than all of them: a shopper
 * cannot act on four refusals at once, and the fix for the first is usually to
 * remove that seller's items, which changes the rest anyway.
 */
export function codAvailability(groups: CodGroup[], shopTakesCash = true): { available: true } | { available: false; because: CodRefusal } {
  /* Turned off for the whole shop (3.2.2: "the ability to disable it
     administratively"): first, since no seller's answer matters then. */
  if (!shopTakesCash) return { available: false, because: { kind: "shop", vendorName: "" } };
  for (const group of groups) {
    if (!group.rule.accepts) {
      return { available: false, because: { kind: "seller", vendorName: group.vendorName } };
    }
    const ceiling = amount(group.rule.ceiling);
    /* A ceiling of zero is not "no cash at all" — that is what `accepts`
       says — so an unreadable or absent one means no ceiling. */
    if (ceiling !== null && ceiling > 0n && compareMoney(group.goods, group.rule.ceiling!) > 0) {
      return { available: false, because: { kind: "ceiling", vendorName: group.vendorName, ceiling: group.rule.ceiling! } };
    }
  }
  return { available: true };
}

/**
 * The payment states a cash order moves through.
 *
 * It is placed `pending_payment` and stays there. Nothing has been paid: the
 * shopper has agreed to hand money to a driver, and until somebody records
 * that it happened, saying `paid` would be recording a payment that has not
 * occurred — which is exactly what the finance panel would then report as
 * revenue.
 */
export const COD_PLACES_AS = "pending_payment" as const;

/** Whether an order taken in cash may be marked collected. */
export function canRecordCollection(order: { status: string; paymentMethod: string | null }): boolean {
  return order.paymentMethod === "cod" && order.status === "pending_payment";
}
