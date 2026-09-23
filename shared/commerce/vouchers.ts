/**
 * A discount code, and a gift card, at the till.
 *
 * Requirement 3.2.3 — the third leg of it, points being `referral.ts`. Pure,
 * for the reason the order arithmetic is: what this decides is money somebody
 * pays, and a rule you can only exercise by typing a real code into a real
 * checkout is one nobody checks.
 *
 * ## A code is a discount; a gift card is money
 *
 * That sentence decides the order they apply in. A discount code reduces what
 * is owed, so it comes off first, and points come off next for the same
 * reason. A gift card *pays* — it is a bill somebody already settled — so it
 * goes last, against whatever is still owed. Applying it first would spend a
 * customer's own money on a discount the shop was giving away anyway.
 *
 * ## Nothing here is stored as a state
 *
 * A code that has expired says so because `ends_at` has passed, never because
 * a job went round and wrote "expired" — the decision the discount permit and
 * the price offers both make, and for the same reason: until that job runs the
 * row claims something that is no longer true.
 *
 * ## The reasons are keys and they are specific
 *
 * "That code cannot be used" is the answer that makes somebody type it four
 * more times. Expired, not started, all used up, already used by you, and
 * below the minimum spend are five different things a shopper can act on.
 */
import { addMoney, compareMoney, fromFils, subtractMoney, toFils } from "../money.js";

/** How a code takes money off. */
export const VOUCHER_KINDS = ["percent", "fixed"] as const;
export type VoucherKind = (typeof VOUCHER_KINDS)[number];

export type DiscountCode = {
  code: string;
  kind: VoucherKind;
  /** "10" for ten percent, or "5.000" for five dinars. */
  value: string;
  minSpend: string | null;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  /** Across everybody. Null is unlimited. */
  maxRedemptions: number | null;
  /** How many times one shopper may use it. */
  perShopper: number;
};

export type VoucherRefusal =
  | "voucher.unknown"
  | "voucher.notYet"
  | "voucher.expired"
  | "voucher.allUsed"
  | "voucher.alreadyUsed"
  | "voucher.belowMinimum";

/**
 * How people actually type a code.
 *
 * Upper-cased, and spaces and dashes dropped, because a code is read off a
 * screenshot or out loud and "welcome 10" and "WELCOME-10" are the same
 * intention. Stored the same way, so the comparison is exact rather than a
 * `lower(code)` index nobody remembers to add.
 */
export function normaliseCode(text: string): string {
  return text.trim().toUpperCase().replace(/[\s-]+/g, "");
}

/**
 * Whether this code may be used on this basket, by this shopper, now.
 *
 * Every refusal is a key the client says in the shopper's own language, and
 * each names one fixable thing.
 */
export function voucherRefusal(
  code: DiscountCode,
  context: { goods: string; used: number; usedByShopper: number; now?: Date },
): VoucherRefusal | null {
  const now = context.now ?? new Date();
  const from = code.startsAt ? new Date(code.startsAt) : null;
  const until = code.endsAt ? new Date(code.endsAt) : null;

  if (from && now < from) return "voucher.notYet";
  if (until && now > until) return "voucher.expired";
  if (code.maxRedemptions !== null && context.used >= code.maxRedemptions) return "voucher.allUsed";
  if (context.usedByShopper >= Math.max(1, code.perShopper)) return "voucher.alreadyUsed";
  if (code.minSpend && compareMoney(context.goods, code.minSpend) < 0) return "voucher.belowMinimum";
  return null;
}

/**
 * What the code takes off, in money.
 *
 * Capped at the goods, because a discount is not a payout: a fixed KWD 5 code
 * on a KWD 3 basket takes off 3 and leaves nothing owing, rather than leaving
 * the shop owing 2. Percentages are computed in fils and rounded **down**, the
 * discipline `unitPrice` and the cash-out already follow — rounding a discount
 * up would invent money in the shopper's favour and still be inventing money.
 */
export function discountOf(code: Pick<DiscountCode, "kind" | "value">, goods: string): string {
  const goodsFils = toFils(goods);
  if (goodsFils <= 0n) return "0.000";

  if (code.kind === "fixed") {
    const asked = toFils(code.value);
    return fromFils(asked > goodsFils ? goodsFils : asked);
  }

  /* Percent in hundredths so "12.5" stays exact: fils × 1250 / 10000, the same
     arithmetic the commission split uses. */
  const hundredths = BigInt(Math.round(Math.max(0, Number.parseFloat(code.value || "0")) * 100));
  const off = (goodsFils * hundredths) / 10_000n;
  return fromFils(off > goodsFils ? goodsFils : off);
}

/**
 * What a gift card pays toward a bill.
 *
 * The lesser of what is left on the card and what is still owed — partial use
 * is the ordinary case, and a card that had to be spent in one go would be a
 * voucher with extra steps.
 */
export function giftCardPayment(remaining: string, owed: string): string {
  if (compareMoney(remaining, owed) < 0) return remaining;
  return owed;
}

export type VoucherRefusalGift = "gift.unknown" | "gift.expired" | "gift.empty";

/** Whether a gift card can pay anything at all. */
export function giftCardRefusal(
  card: { remaining: string; expiresAt: Date | string | null },
  now = new Date(),
): VoucherRefusalGift | null {
  if (card.expiresAt && now > new Date(card.expiresAt)) return "gift.expired";
  if (toFils(card.remaining) <= 0n) return "gift.empty";
  return null;
}

/**
 * The whole till, in order: goods, then the code, then points, then the card.
 *
 * One function so the checkout summary and the order writer cannot disagree
 * about what is owed — the same reason the password floor is one function on
 * both sides.
 */
export function settle(input: {
  goods: string;
  delivery: string;
  discount?: string;
  points?: string;
  giftCard?: string;
}): { discount: string; points: string; giftCard: string; payable: string } {
  const total = addMoney(input.goods, input.delivery);

  /* Each in turn, and each capped at what is still owed: three reductions that
     could each cover the basket must not add up to a negative bill. */
  const discount = capped(input.discount ?? "0.000", total);
  const afterDiscount = subtractMoney(total, discount);

  const points = capped(input.points ?? "0.000", afterDiscount);
  const afterPoints = subtractMoney(afterDiscount, points);

  const giftCard = capped(input.giftCard ?? "0.000", afterPoints);
  return { discount, points, giftCard, payable: subtractMoney(afterPoints, giftCard) };
}

function capped(amount: string, ceiling: string): string {
  return compareMoney(amount, ceiling) > 0 ? ceiling : amount;
}
