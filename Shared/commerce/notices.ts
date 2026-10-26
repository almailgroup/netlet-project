/**
 * What NetLet tells somebody, and when — the inbox and the email behind it.
 *
 * Until this existed, "Tell me when it is back" and "Tell me if the price
 * drops" stored a wish and nothing ever answered it, and the notification
 * preferences on the account page switched off messages nobody sent. Every
 * kind here is something that already happens in the shop; this only says who
 * hears about it.
 *
 * Pure, so the rules — which preference silences what, which kinds are
 * emailed, what makes two events the same event — are tested without a
 * database, and the page draws a stored notice with the same function the
 * email does.
 *
 * ## A notice is a message key and its values, never a sentence
 *
 * The support answer's rule: a notice written in English reads in Arabic
 * when its recipient switches next week. Merchant text arrives in both of the
 * languages it was typed in (`product` and `productAr`) and the reader picks;
 * an amount is stored as the bare figure and formatted where it is drawn.
 *
 * ## The same event is told once
 *
 * Every notice carries a `dedupe` key that names the event — the order's
 * reference and the state, the product and the day — and the table's unique
 * index refuses a second row with it. A double press, a retried request or
 * two sellers moving two lines of one order to "shipped" tell the shopper
 * once, by construction rather than by care.
 */
import type { MessageKey } from "../i18n/dictionary.js";
import { kuwaitDay } from "../kuwaitDay.js";
import type { NotificationKind } from "../customer.js";

export const NOTICE_KINDS = [
  "order_placed",
  "order_on_the_way",
  "order_delivered",
  "line_cancelled",
  "return_approved",
  "return_declined",
  "exchange_sent",
  "refund_done",
  "back_in_stock",
  "price_drop",
  "offer_answered",
  "support_answered",
  "bag_reminder",
  "new_arrival",
  "seller_new_order",
  "seller_return",
  "seller_warning",
  "seller_suspended",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * Whether a stored kind is one the shop still has. A kind that went — the
 * shopper–store messages, removed on the owner's word — may still have rows,
 * and they are left out of the inbox, its count and the email queue rather
 * than drawn with a sentence the dictionary no longer carries.
 */
export function isNoticeKind(kind: string): kind is NoticeKind {
  return (NOTICE_KINDS as readonly string[]).includes(kind);
}

type NoticeRule = {
  /** Who reads it: a shopper on their account, or a store's people in the portal. */
  audience: "shopper" | "seller";
  /** The account preference that silences it, or null when nothing should. */
  preference: NotificationKind | null;
  /** Whether it goes out by email too, while email is configured. */
  email: boolean;
  /** The sentence, with `{placeholders}` from the notice's params. */
  key: MessageKey;
};

/**
 * The rules, one per kind.
 *
 * Money is never silenced: an order confirmation, a cancelled item, a decided
 * return and a paid refund are owed whatever the preferences say, and they
 * are what the preference page does not list.
 * **A new arrival is in the inbox only, never emailed**: it is the one kind
 * NetLet starts rather than the shopper, which is marketing, and an inbox the
 * shopper opens is a different thing from mail they did not ask for.
 */
export const NOTICE_RULES: Record<NoticeKind, NoticeRule> = {
  order_placed: { audience: "shopper", preference: null, email: true, key: "notice.orderPlaced" },
  order_on_the_way: { audience: "shopper", preference: "delivery_update", email: true, key: "notice.orderOnTheWay" },
  order_delivered: { audience: "shopper", preference: "delivery_update", email: true, key: "notice.orderDelivered" },
  line_cancelled: { audience: "shopper", preference: null, email: true, key: "notice.lineCancelled" },
  return_approved: { audience: "shopper", preference: null, email: true, key: "notice.returnApproved" },
  return_declined: { audience: "shopper", preference: null, email: true, key: "notice.returnDeclined" },
  exchange_sent: { audience: "shopper", preference: "delivery_update", email: true, key: "notice.exchangeSent" },
  refund_done: { audience: "shopper", preference: null, email: true, key: "notice.refundDone" },
  back_in_stock: { audience: "shopper", preference: null, email: true, key: "notice.backInStock" },
  price_drop: { audience: "shopper", preference: "price_drop", email: true, key: "notice.priceDrop" },
  offer_answered: { audience: "shopper", preference: null, email: true, key: "notice.offerAnswered" },
  support_answered: { audience: "shopper", preference: null, email: true, key: "notice.supportAnswered" },
  bag_reminder: { audience: "shopper", preference: "bag_reminder", email: true, key: "notice.bagReminder" },
  new_arrival: { audience: "shopper", preference: "new_arrival", email: false, key: "notice.newArrival" },
  seller_new_order: { audience: "seller", preference: null, email: true, key: "notice.sellerNewOrder" },
  seller_return: { audience: "seller", preference: null, email: true, key: "notice.sellerReturn" },
  /* A warning NetLet issued, and the third that suspended the store (3.3.18):
     never silenced, because a store must know where it stands. */
  seller_warning: { audience: "seller", preference: null, email: true, key: "notice.sellerWarning" },
  seller_suspended: { audience: "seller", preference: null, email: true, key: "notice.sellerSuspended" },
};

/** One thing to tell one person. */
export type Notice = {
  userId: number;
  kind: NoticeKind;
  params?: Record<string, string | number>;
  /** A path on this site, never another site's address. */
  link?: string | null;
  dedupe: string;
};

/** How many notices one page of the inbox holds. */
export const INBOX_PAGE_SIZE = 20;

/** How many times an email is tried before it is given up on, and how long between tries. */
export const EMAIL_ATTEMPTS = 5;
export function retryAfterMs(attempts: number): number {
  /* 1, 4, 16, 64 minutes: a provider's bad minute passes, a bad address fails
     inside a day rather than being tried for ever. */
  return 60_000 * 4 ** Math.max(0, attempts - 1);
}

/**
 * Whether a link may be stored on a notice: a path on this site.
 *
 * A notice's link is drawn as an anchor and put in an email, so an absolute
 * address — or `//elsewhere`, which a browser reads as one — would make the
 * inbox a way to send somebody off the site under NetLet's name.
 */
export function isSiteLink(link: string | null | undefined): link is string {
  return typeof link === "string" && /^\/(?![/\\])[^\s]*$/.test(link) && link.length <= 500;
}

/**
 * Whether a preference row silences a kind. No row means the default — the
 * preference page's own defaults, so the switch a shopper sees and the
 * messages they get cannot disagree.
 */
export function silenced(
  kind: NoticeKind,
  preferences: ReadonlyMap<NotificationKind, boolean>,
  defaults: Record<NotificationKind, boolean>,
): boolean {
  const preference = NOTICE_RULES[kind].preference;
  if (!preference) return false;
  return !(preferences.get(preference) ?? defaults[preference]);
}

/** Whether a notice of this kind goes out by email to somebody who allows email. */
export function emailed(kind: NoticeKind, allowsEmail: boolean): boolean {
  return allowsEmail && NOTICE_RULES[kind].email;
}

/* ------------------------------------------------------------- products --- */

/** What a follower cares about on a product: whether it can be bought, and its lowest price, in fils. */
export type ProductState = { available: boolean; lowestFils: bigint | null };

/**
 * Whether a product just came back — it could not be bought and now it can.
 *
 * "Available" is the shop's own sense: published, from an open store, with
 * something on the shelf or a pre-order allowance. So a product that comes
 * back from a suspension or a draft is back too; to a follower, it was gone.
 */
export function cameBack(before: ProductState, after: ProductState): boolean {
  return !before.available && after.available;
}

/**
 * Whether the lowest price fell, on a product that can be bought.
 *
 * The notice names the new price and **never the old one**: a figure beside
 * a struck-through one is how a shop advertises a saving, which needs the
 * Ministry permit (`discountLicence.ts`), and a price-drop alert that quoted
 * the old price would be that advertisement delivered to an inbox. The
 * shopper asked to be told when the price drops; the sentence says what it is
 * now.
 */
export function priceFell(before: ProductState, after: ProductState): boolean {
  return after.available && before.lowestFils !== null && after.lowestFils !== null && after.lowestFils < before.lowestFils;
}

/* --------------------------------------------------------------- dedupe --- */

/** The day, in Kuwait, an event happened — what makes "the same news today" one notice. */
export const dayOf = (at: Date) => kuwaitDay(at);

export const dedupe = {
  order: (reference: string, state: string) => `order:${reference}:${state}`,
  line: (lineId: number, state: string) => `line:${lineId}:${state}`,
  returnRequest: (requestId: number, state: string) => `return:${requestId}:${state}`,
  backInStock: (productId: number | string, at: Date) => `stock:${productId}:${dayOf(at)}`,
  priceDrop: (productId: number | string, fils: bigint, at: Date) => `price:${productId}:${fils}:${dayOf(at)}`,
  offer: (offerId: number, state: string) => `offer:${offerId}:${state}`,
  /** A reply resets on the reader's next look, so one notice per thread per day is enough. */
  thread: (kind: "support", threadId: number, at: Date) => `${kind}:${threadId}:${dayOf(at)}`,
  /** One reminder per basket as it stands: touching the basket is a new basket to remind about. */
  bag: (cartId: string, updatedAt: Date) => `bag:${cartId}:${updatedAt.getTime()}`,
  /** A store's new listings, one notice a week whatever it publishes. */
  newArrival: (vendorId: number, at: Date) => `new:${vendorId}:${isoWeek(at)}`,
};

/** The ISO week of a Kuwaiti day, as `2026-W42`. */
export function isoWeek(at: Date): string {
  const [year, month, day] = kuwaitDay(at).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - first.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/* -------------------------------------------------------------- drawing --- */

/** Params that hold an amount, drawn as money wherever the notice is read. */
export const MONEY_PARAMS = ["price", "amount", "total"] as const;

/**
 * The values a notice's sentence is drawn with, in the reader's language.
 *
 * `product` and `store` come with their Arabic twins (`productAr`,
 * `storeAr`), because merchant text is in whatever language it was typed; the
 * Arabic one is used on the Arabic page when it was given. `format` draws an
 * amount the way the page draws money, so the inbox and the email cannot
 * disagree with the order page about a figure.
 */
export function noticeValues(
  params: Readonly<Record<string, string | number>>,
  arabic: boolean,
  format: (amount: string) => string,
): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (name.endsWith("Ar")) continue;
    const twin = params[`${name}Ar`];
    values[name] = arabic && typeof twin === "string" && twin.trim() ? twin : value;
  }
  for (const name of MONEY_PARAMS) {
    if (typeof values[name] === "string" || typeof values[name] === "number") values[name] = format(String(values[name]));
  }
  return values;
}
