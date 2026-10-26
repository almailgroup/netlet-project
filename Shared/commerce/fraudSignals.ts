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
export function riskOf(flags: { serious: boolean }[]): RiskLevel {
  if (flags.some(flag => flag.serious)) return "high";
  if (flags.length >= 3) return "high";
  return flags.length > 0 ? "watch" : "low";
}

/* --------------------------------------------------------- fake reviews --- */

/**
 * Reviews that do not look like a shopper's own (3.6.5: "fake reviews").
 *
 * The same rule as orders: flag and never act. Hiding a review is a person's
 * press, with a reason, on the fraud page; every signal carries the counts
 * behind it. A review on NetLet already needs a delivered line of the
 * reviewer's own (`eligibilityFor`), so what is left to watch is whose hand is
 * behind the order.
 */
export const REVIEW_SIGNALS = ["reviewerIsSeller", "reviewersShareAddress", "reviewBurst", "newAccountReview", "sameRatingEveryTime"] as const;
export type ReviewSignal = (typeof REVIEW_SIGNALS)[number];
export type ReviewFlag = { signal: ReviewSignal; serious: boolean; detail: Record<string, number | string> };

export type ReviewContext = {
  rating: number;
  /** Whether the reviewer belongs to the store that sells it. */
  reviewerIsSeller: boolean;
  /** Other accounts that reviewed this product and had it delivered to the same address. */
  otherReviewersAtAddress: number;
  /** Reviews of this product within a day either side of this one, this one included. */
  reviewsSameDay: number;
  /** How old the account was when the review was written. */
  accountAgeHours: number;
  /** The reviewer's reviews across the shop, and how many distinct star counts they gave. */
  reviewerReviews: number;
  reviewerDistinctRatings: number;
};

/** More reviews of one product than this inside a day is a campaign rather than customers. */
export const REVIEW_BURST = 5;
/** A reviewer younger than this bought, received and reviewed in under two days. */
export const NEW_REVIEWER_HOURS = 48;
/** Every review the same extreme rating, across at least this many. */
export const SAME_RATING_REVIEWS = 3;

export function reviewFlags(context: ReviewContext): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  /* A store's own people rating its products is the plainest fake there is. */
  if (context.reviewerIsSeller) flags.push({ signal: "reviewerIsSeller", serious: true, detail: {} });
  if (context.otherReviewersAtAddress > 0) {
    flags.push({ signal: "reviewersShareAddress", serious: true, detail: { accounts: context.otherReviewersAtAddress + 1 } });
  }
  if (context.reviewsSameDay > REVIEW_BURST) flags.push({ signal: "reviewBurst", serious: false, detail: { reviews: context.reviewsSameDay } });
  if (context.accountAgeHours < NEW_REVIEWER_HOURS) flags.push({ signal: "newAccountReview", serious: false, detail: { hours: Math.floor(context.accountAgeHours) } });
  if (context.reviewerReviews >= SAME_RATING_REVIEWS && context.reviewerDistinctRatings === 1 && (context.rating === 1 || context.rating === 5)) {
    flags.push({ signal: "sameRatingEveryTime", serious: false, detail: { reviews: context.reviewerReviews, rating: context.rating } });
  }
  return [...flags].sort((a, b) => Number(b.serious) - Number(a.serious));
}

/* ------------------------------------------------------ referral abuse --- */

/**
 * Referrals that look like one person inviting themselves (3.6.5: "points and
 * referral system abuse"). Nobody may refer their own account, which the
 * referral rule already refuses; what it cannot see is a second account. A
 * shared door, a shared phone, an address that is the same mailbox in a
 * different coat, and a burst of invitations that each bought once — each is
 * a reason to look before the cash-out is paid, never a refusal.
 */
export const REFERRAL_SIGNALS = ["sharedAddress", "sharedPhone", "similarEmail", "qualifyingRefunded", "referralBurst"] as const;
export type ReferralSignal = (typeof REFERRAL_SIGNALS)[number];
export type ReferralFlag = { signal: ReferralSignal; serious: boolean; detail: Record<string, number | string> };

export type ReferralContext = {
  sharedAddress: boolean;
  sharedPhone: boolean;
  referrerEmail: string;
  referredEmail: string;
  /** The order that paid the points was refunded or cancelled afterwards. */
  qualifyingRefunded: boolean;
  /** Accounts this referrer brought in within a week either side of this one. */
  referrerWeek: number;
};

/** More invitations than this landing in a week is a script or a sale of codes. */
export const REFERRAL_BURST = 5;

/**
 * Whether two addresses are one mailbox: the same local part once a `+tag` is
 * dropped, Gmail's dots ignored and trailing digits taken off — `noura.k+2@`,
 * `nourak@` and `nourak7@` are one person to anybody reading them.
 */
export function emailsAlike(a: string, b: string): boolean {
  const base = (email: string) => {
    const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
    const gmail = domain === "gmail.com" || domain === "googlemail.com";
    const untagged = local.split("+")[0];
    return (gmail ? untagged.replace(/\./g, "") : untagged).replace(/\d+$/, "");
  };
  const left = base(a);
  return left.length >= 3 && left === base(b);
}

export function referralFlags(context: ReferralContext): ReferralFlag[] {
  const flags: ReferralFlag[] = [];
  if (context.sharedAddress) flags.push({ signal: "sharedAddress", serious: true, detail: {} });
  if (context.sharedPhone) flags.push({ signal: "sharedPhone", serious: true, detail: {} });
  if (emailsAlike(context.referrerEmail, context.referredEmail)) flags.push({ signal: "similarEmail", serious: true, detail: {} });
  if (context.qualifyingRefunded) flags.push({ signal: "qualifyingRefunded", serious: false, detail: {} });
  if (context.referrerWeek > REFERRAL_BURST) flags.push({ signal: "referralBurst", serious: false, detail: { referrals: context.referrerWeek } });
  return [...flags].sort((a, b) => Number(b.serious) - Number(a.serious));
}
