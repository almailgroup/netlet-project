/**
 * Reading an order for the shapes that usually mean trouble.
 *
 * Requirement 3.6.5. Pure, because what this decides is which orders a human
 * looks at before a driver sets off with the goods — and a rule you can only
 * exercise by being defrauded is one nobody checks.
 *
 * ## It flags and never blocks
 *
 * Nothing here cancels an order, refuses a checkout or holds a parcel. Every
 * signal is a **reason to look**, carried with the counts that produced it,
 * and a human decides — the same shape `productReview` takes for listings and
 * `vendorHealth` takes for sellers. A heuristic that could refuse a sale is a
 * heuristic that refuses a real customer at the till, and the shop never finds
 * out which ones it turned away.
 *
 * ## Cash is where the risk actually is
 *
 * NetLet takes cash on delivery and nothing else today, which means the goods
 * leave the warehouse before any money exists. That is the whole reason this
 * is worth having: a card charge-back is a dispute, but an uncollected cash
 * order is a van, a driver and a parcel nobody paid for. So the value
 * thresholds apply to cash and the card branches wait with 3.2.1.
 *
 * ## Every signal names its evidence
 *
 * "Risk: high" tells an administrator nothing they can act on. "Four accounts
 * have used this address in the last thirty days" is checkable, and when it
 * turns out to be a family or an office they can say so and move on.
 */

/** What was noticed. A key the client translates, never a sentence. */
export const FRAUD_SIGNALS = [
  "newAccountHighValue",
  "addressManyAccounts",
  "rapidOrders",
  "refundHistory",
  "highValueCash",
  "firstOrderLargeQuantity",
] as const;
export type FraudSignal = (typeof FRAUD_SIGNALS)[number];

/** How hard to look. `high` is "do not dispatch before somebody checks". */
export type RiskLevel = "low" | "watch" | "high";

export type Flag = {
  signal: FraudSignal;
  /** Whether this one alone is enough to hold a parcel. */
  serious: boolean;
  /** The counts behind it, so an administrator can disagree with them. */
  detail: Record<string, number | string>;
};

/**
 * What an order looks like from the platform's side.
 *
 * Deliberately counts rather than rows: this is pure, and handing it other
 * people's orders to sift would make the fraud check the one place that reads
 * every shopper's history in memory.
 */
export type OrderContext = {
  /** What the shopper is being trusted with, in dinars as a decimal string. */
  grandTotal: string;
  paymentMethod: string | null;
  /** How old the account was when the order was placed. */
  accountAgeHours: number;
  /** Orders this account placed in the last day, this one included. */
  ordersLastDay: number;
  /** How many *other* accounts have ordered to this address lately. */
  accountsAtAddress: number;
  /** This account's own history: how many orders, and how many were refunded. */
  ordersAllTime: number;
  refundedAllTime: number;
  /** The largest quantity on any one line. */
  largestLineQuantity: number;
};

/** A cash order worth more than this is worth a second look before it goes out. */
export const CASH_CEILING = 150;

/** An account younger than this has no history to judge it by. */
export const NEW_ACCOUNT_HOURS = 24;

/** Above this on a new account, the cash ceiling stops being the only question. */
export const NEW_ACCOUNT_CEILING = 60;

/** More orders than this from one account in a day is not shopping. */
export const RAPID_ORDERS = 4;

/** More accounts than this at one address is a household or something else. */
export const ADDRESS_ACCOUNTS = 3;

/** A refund rate above this, with enough orders to mean anything. */
export const REFUND_RATE = 0.5;
export const REFUND_FLOOR = 3;

/** Ten of one thing on a first order is a reseller or a test of the card. */
export const FIRST_ORDER_QUANTITY = 10;

/**
 * Everything worth noticing about one order.
 *
 * Ordered serious first, because an administrator reads the top of a list and
 * the ordering is the only prioritising this does.
 */
export function fraudFlags(context: OrderContext): Flag[] {
  const flags: Flag[] = [];
  const total = Number.parseFloat(context.grandTotal || "0");
  const cash = context.paymentMethod === "cod";

  /*
   * A new account and real money, paid in cash. This is the combination that
   * costs a marketplace most: there is nothing to charge back, nothing to
   * recover, and no history saying the person is who they say.
   */
  if (cash && context.accountAgeHours < NEW_ACCOUNT_HOURS && total >= NEW_ACCOUNT_CEILING) {
    flags.push({
      signal: "newAccountHighValue",
      serious: true,
      detail: { hours: Math.floor(context.accountAgeHours), total: context.grandTotal },
    });
  }

  /* The goods leave before the money exists, so the amount is the exposure. */
  if (cash && total >= CASH_CEILING) {
    flags.push({ signal: "highValueCash", serious: total >= CASH_CEILING * 2, detail: { total: context.grandTotal } });
  }

  /*
   * Several accounts ordering to one address is a family, an office, or one
   * person spreading orders across accounts to stay under a ceiling. It is
   * genuinely ambiguous, which is exactly why it is shown rather than acted on.
   */
  if (context.accountsAtAddress > ADDRESS_ACCOUNTS) {
    flags.push({ signal: "addressManyAccounts", serious: false, detail: { accounts: context.accountsAtAddress } });
  }

  if (context.ordersLastDay > RAPID_ORDERS) {
    flags.push({ signal: "rapidOrders", serious: false, detail: { orders: context.ordersLastDay } });
  }

  /*
   * A refund rate only means something with enough orders behind it: one
   * refund out of one order is a shopper who changed their mind, and treating
   * it as a pattern is how a first complaint becomes a black mark.
   */
  if (context.ordersAllTime >= REFUND_FLOOR && context.refundedAllTime / context.ordersAllTime > REFUND_RATE) {
    flags.push({
      signal: "refundHistory",
      serious: false,
      detail: { refunded: context.refundedAllTime, orders: context.ordersAllTime },
    });
  }

  if (context.ordersAllTime <= 1 && context.largestLineQuantity >= FIRST_ORDER_QUANTITY) {
    flags.push({ signal: "firstOrderLargeQuantity", serious: false, detail: { quantity: context.largestLineQuantity } });
  }

  return [...flags].sort((a, b) => Number(b.serious) - Number(a.serious));
}

/**
 * How much attention this order wants.
 *
 * Three bands rather than a score, because a number asks an administrator to
 * decide what 62 means. `high` is one serious signal or three of anything —
 * several small oddities about one order is itself the pattern.
 */
export function riskOf(flags: Flag[]): RiskLevel {
  if (flags.some(flag => flag.serious)) return "high";
  if (flags.length >= 3) return "high";
  return flags.length > 0 ? "watch" : "low";
}
