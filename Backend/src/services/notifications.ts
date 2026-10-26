/**
 * The inbox and the email behind it — the database half of
 * `Shared/commerce/notices.ts`.
 *
 * Every caller tells somebody **after** its own act has committed, through
 * `notifyQuietly`, which logs and never throws: an order that fails because
 * its confirmation could not be written would be the shop punishing the
 * shopper for its own mail. The same reason `issueQuietly` exists for
 * invoices.
 *
 * Email is written only while it is configured (`emailConfigured`), and the
 * notice is tried at once with a deadline; anything that did not go is left
 * pending for `sendDueEmails`, which the daily cron runs. Claimed by a
 * predicate on the row, so a sweep and a send racing for one email send it
 * once.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  cartItems,
  carts,
  customerNotificationPreferences,
  customerPreferences,
  followedProducts,
  inboundLines,
  notificationDeliveries,
  notifications,
  orderItems,
  orders,
  priceOffers,
  productVariants,
  products,
  returnRequests,
  supportConversations,
  users,
  vendorMembers,
  vendors,
} from "../../database/schema.js";
import {
  EMAIL_ATTEMPTS,
  INBOX_PAGE_SIZE,
  NOTICE_KINDS,
  NOTICE_RULES,
  cameBack,
  dedupe,
  emailed,
  isNoticeKind,
  isSiteLink,
  noticeValues,
  priceFell,
  retryAfterMs,
  silenced,
  type Notice,
  type NoticeKind,
  type ProductState,
} from "../../../Shared/commerce/notices.js";
import { recoveryFor } from "../../../Shared/commerce/cartRecovery.js";
import { defaultNotificationPreferences, type NotificationKind } from "../../../Shared/customer.js";
import { translate, type LocaleCode } from "../../../Shared/i18n/dictionary.js";
import { fromFils, toFils } from "../../../Shared/money.js";
import { clampPage, offsetFor } from "../../../Shared/pagination.js";
import { emailConfigured, noticeEmail, sendEmail, siteOrigin } from "../core/email.js";
import { describeError } from "../core/describeError.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/* ------------------------------------------------------------- telling --- */

/**
 * Writes notices, at most once each, and emails the ones that go by email.
 * Returns how many were new. A notice a preference silences is not written at
 * all — the preference says "do not tell me", not "tell me quietly".
 */
export async function notify(input: Notice | readonly Notice[]): Promise<number> {
  const all: readonly Notice[] = Array.isArray(input) ? (input as readonly Notice[]) : [input as Notice];
  const list = all.filter(notice => notice.userId > 0);
  if (!list.length) return 0;
  const db = await getDb();
  if (!db) return 0;

  const userIds = [...new Set(list.map(notice => notice.userId))];
  const rows = await db
    .select({ userId: customerNotificationPreferences.userId, kind: customerNotificationPreferences.kind, enabled: customerNotificationPreferences.enabled })
    .from(customerNotificationPreferences)
    .where(inArray(customerNotificationPreferences.userId, userIds));
  const preferences = new Map<number, Map<NotificationKind, boolean>>();
  for (const row of rows) {
    const mine = preferences.get(row.userId) ?? new Map<NotificationKind, boolean>();
    mine.set(row.kind as NotificationKind, row.enabled);
    preferences.set(row.userId, mine);
  }
  const wanted = list.filter(notice => !silenced(notice.kind, preferences.get(notice.userId) ?? new Map(), defaultNotificationPreferences));
  if (!wanted.length) return 0;

  const written = await db
    .insert(notifications)
    .values(wanted.map(notice => ({
      userId: notice.userId,
      kind: notice.kind,
      messageKey: NOTICE_RULES[notice.kind].key,
      params: notice.params ?? {},
      link: isSiteLink(notice.link) ? notice.link : null,
      dedupeKey: notice.dedupe.slice(0, 191),
    })))
    .onConflictDoNothing()
    .returning({ id: notifications.id, userId: notifications.userId, kind: notifications.kind });

  if (written.length && emailConfigured()) await queueEmails(db, written);
  return written.length;
}

/** `notify`, for a caller whose own act has already happened. */
export async function notifyQuietly(input: Notice | readonly Notice[]): Promise<void> {
  try {
    await notify(input);
  } catch (error) {
    console.error(`[notices] could not tell anybody: ${describeError(error)}`);
  }
}

async function queueEmails(db: Db, written: { id: number; userId: number; kind: string }[]): Promise<void> {
  const people = await db
    .select({ id: users.id, email: users.email, allows: customerPreferences.notifyEmail })
    .from(users)
    .leftJoin(customerPreferences, eq(customerPreferences.userId, users.id))
    .where(inArray(users.id, [...new Set(written.map(row => row.userId))]));
  const byId = new Map(people.map(person => [person.id, person]));
  const values = written.flatMap(row => {
    const person = byId.get(row.userId);
    /* No preferences row is the default, which is on. */
    if (!person?.email || !emailed(row.kind as NoticeKind, person.allows ?? true)) return [];
    return [{ notificationId: row.id, channel: "email" as const, address: person.email }];
  });
  if (!values.length) return;
  const queued = await db.insert(notificationDeliveries).values(values).onConflictDoNothing().returning({ id: notificationDeliveries.id });
  /* Tried now, side by side, each under the email's own deadline — so the act
     that caused them waits a few seconds at worst, and a failure waits for
     the sweep rather than for the shopper. */
  await Promise.allSettled(queued.map(row => deliver(db, row.id)));
}

/* ------------------------------------------------------------- sending --- */

/** Sends one queued email if it is due and nobody else has it. */
async function deliver(db: Db, deliveryId: number, now = new Date()): Promise<"sent" | "pending" | "failed" | "skipped" | "taken"> {
  const [row] = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, deliveryId)).limit(1);
  if (!row || row.status !== "pending" || row.nextAttemptAt > now) return "taken";
  const attempts = row.attempts + 1;
  /* The claim: moving the next attempt forward with the count we read in the
     predicate, so a second sender reading the same row claims nothing. */
  const [claimed] = await db
    .update(notificationDeliveries)
    .set({ attempts, nextAttemptAt: new Date(now.getTime() + retryAfterMs(attempts)) })
    .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.status, "pending"), eq(notificationDeliveries.attempts, row.attempts)))
    .returning();
  if (!claimed) return "taken";

  const [notice] = await db
    .select({
      kind: notifications.kind,
      messageKey: notifications.messageKey,
      params: notifications.params,
      link: notifications.link,
      locale: customerPreferences.locale,
      allows: customerPreferences.notifyEmail,
    })
    .from(notifications)
    .leftJoin(customerPreferences, eq(customerPreferences.userId, notifications.userId))
    .where(eq(notifications.id, claimed.notificationId))
    .limit(1);
  /* Turned off since it was queued: what they asked for now wins. A kind the
     shop no longer has is not sent either. */
  if (!notice || !(notice.allows ?? true) || !isNoticeKind(notice.kind)) {
    await db.update(notificationDeliveries).set({ status: "skipped" }).where(eq(notificationDeliveries.id, deliveryId));
    return "skipped";
  }

  const email = renderEmail(claimed.address, notice.locale === "ar" ? "ar" : "en", notice);
  const sent = await sendEmail(email);
  if (sent.ok) {
    await db.update(notificationDeliveries).set({ status: "sent", sentAt: now, lastError: null }).where(eq(notificationDeliveries.id, deliveryId));
    return "sent";
  }
  const failed = attempts >= EMAIL_ATTEMPTS;
  await db
    .update(notificationDeliveries)
    .set({ status: failed ? "failed" : "pending", lastError: sent.error })
    .where(eq(notificationDeliveries.id, deliveryId));
  return failed ? "failed" : "pending";
}

/* An amount in an email, written as the page writes it. Western digits on
   both pages, because the amounts everywhere else on NetLet are. */
function emailMoney(locale: LocaleCode, amount: string): string {
  const value = Number.parseFloat(amount);
  if (!Number.isFinite(value)) return amount;
  return new Intl.NumberFormat(locale === "ar" ? "ar-KW-u-nu-latn" : "en-KW", { style: "currency", currency: "KWD" }).format(value);
}

function renderEmail(
  to: string,
  locale: LocaleCode,
  notice: { kind: string; messageKey: string; params: Record<string, string | number>; link: string | null },
) {
  const origin = siteOrigin();
  const values = noticeValues(notice.params, locale === "ar", amount => emailMoney(locale, amount));
  const sentence = translate(locale, notice.messageKey as Parameters<typeof translate>[1], values);
  const seller = NOTICE_RULES[notice.kind as NoticeKind]?.audience === "seller";
  return noticeEmail({
    to,
    arabic: locale === "ar",
    subject: sentence.length > 90 ? `${sentence.slice(0, 87)}…` : sentence,
    sentence,
    action: translate(locale, "notice.emailOpen"),
    link: origin && notice.link ? `${origin}${notice.link}` : null,
    footer: translate(locale, seller ? "notice.emailFooterSeller" : "notice.emailFooter"),
    preferencesLink: origin ? `${origin}/account/preferences` : null,
  });
}

/** Everything due, oldest first — what the daily cron runs. */
export async function sendDueEmails(limit = 50, now = new Date()): Promise<{ sent: number; failed: number }> {
  const db = await getDb();
  if (!db || !emailConfigured()) return { sent: 0, failed: 0 };
  const due = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.status, "pending"), lte(notificationDeliveries.nextAttemptAt, now)))
    .orderBy(asc(notificationDeliveries.nextAttemptAt), asc(notificationDeliveries.id))
    .limit(limit);
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    const outcome = await deliver(db, row.id, now);
    if (outcome === "sent") sent += 1;
    if (outcome === "failed") failed += 1;
  }
  return { sent, failed };
}

/* --------------------------------------------------------------- inbox --- */

/* Only the kinds the shop still has (`isNoticeKind`'s reason). */
const current = inArray(notifications.kind, [...NOTICE_KINDS]);

export type InboxEntry = {
  id: number;
  kind: string;
  messageKey: string;
  params: Record<string, string | number>;
  link: string | null;
  read: boolean;
  createdAt: Date;
};

export async function inboxFor(userId: number, page = 1): Promise<{ entries: InboxEntry[]; total: number; unread: number; page: number; pageSize: number }> {
  const db = await getDb();
  if (!db) return { entries: [], total: 0, unread: 0, page: 1, pageSize: INBOX_PAGE_SIZE };
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unread: sql<number>`count(*) filter (where ${notifications.readAt} is null)::int`,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), current));
  const total = counts?.total ?? 0;
  const at = clampPage(page, total, INBOX_PAGE_SIZE);
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), current))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(INBOX_PAGE_SIZE)
    .offset(offsetFor(at, INBOX_PAGE_SIZE));
  return {
    entries: rows.map(row => ({
      id: row.id,
      kind: row.kind,
      messageKey: row.messageKey,
      params: row.params,
      link: row.link,
      read: row.readAt !== null,
      createdAt: row.createdAt,
    })),
    total,
    unread: counts?.unread ?? 0,
    page: at,
    pageSize: INBOX_PAGE_SIZE,
  };
}

export async function unreadNotices(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), current));
  return row?.n ?? 0;
}

/** Marks some or all of one person's notices read. Another person's ids mark nothing. */
export async function markNoticesRead(userId: number, ids: number[] | "all", now = new Date()): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const mine = and(eq(notifications.userId, userId), isNull(notifications.readAt));
  if (ids === "all") {
    await db.update(notifications).set({ readAt: now }).where(mine);
  } else if (ids.length) {
    await db.update(notifications).set({ readAt: now }).where(and(mine, inArray(notifications.id, ids)));
  }
}

export async function emailPreference(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const [row] = await db.select({ allows: customerPreferences.notifyEmail }).from(customerPreferences).where(eq(customerPreferences.userId, userId)).limit(1);
  return row?.allows ?? true;
}

export async function setEmailPreference(userId: number, allows: boolean): Promise<boolean> {
  const db = await getDb();
  if (!db) return allows;
  await db
    .insert(customerPreferences)
    .values({ userId, notifyEmail: allows })
    .onConflictDoUpdate({ target: customerPreferences.userId, set: { notifyEmail: allows } });
  return allows;
}

/* ---------------------------------------------------------- recipients --- */

/** Everybody who works a store, by store. */
export async function storePeople(db: Db, vendorIds: number[]): Promise<Map<number, number[]>> {
  const people = new Map<number, number[]>();
  if (!vendorIds.length) return people;
  const rows = await db
    .select({ vendorId: vendorMembers.vendorId, userId: vendorMembers.userId })
    .from(vendorMembers)
    .where(inArray(vendorMembers.vendorId, [...new Set(vendorIds)]));
  for (const row of rows) people.set(row.vendorId, [...(people.get(row.vendorId) ?? []), row.userId]);
  return people;
}

/** Tells every member of a store the same thing. */
export async function notifyStore(vendorId: number, notice: Omit<Notice, "userId">): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const people = (await storePeople(db, [vendorId])).get(vendorId) ?? [];
    await notifyQuietly(people.map(userId => ({ ...notice, userId })));
  } catch (error) {
    console.error(`[notices] could not tell store ${vendorId}: ${describeError(error)}`);
  }
}

/* ------------------------------------------------------------ products --- */

/** Whether each product can be bought and its lowest price — what a follower is waiting on. */
export async function productStates(db: Db, productIds: number[]): Promise<Map<number, ProductState & { handle: string; title: string; titleAr: string | null; vendorId: number }>> {
  const states = new Map<number, ProductState & { handle: string; title: string; titleAr: string | null; vendorId: number }>();
  const ids = [...new Set(productIds)].filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return states;
  const rows = await db
    .select({
      id: products.id,
      handle: products.handle,
      title: products.title,
      titleAr: products.titleAr,
      vendorId: products.vendorId,
      status: products.status,
      vendorStatus: vendors.status,
      lowest: sql<string | null>`min(${productVariants.price})`,
      onShelf: sql<boolean>`coalesce(bool_or(${productVariants.stock} > 0 or ${productVariants.preorderStock} > 0), false)`,
    })
    .from(products)
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .where(inArray(products.id, ids))
    .groupBy(products.id, vendors.status);
  for (const row of rows) {
    states.set(row.id, {
      available: row.status === "published" && row.vendorStatus === "approved" && Boolean(row.onShelf),
      lowestFils: row.lowest === null ? null : toFils(row.lowest),
      handle: row.handle,
      title: row.title,
      titleAr: row.titleAr,
      vendorId: row.vendorId,
    });
  }
  return states;
}

/**
 * Runs an act that may change whether products can be bought or what they
 * cost, and tells their followers what changed: back in stock, or a lower
 * price.
 *
 * Read before and after rather than worked out from the act, because stock
 * and prices change through a dozen doors — a receipt, a correction, a
 * cancelled line, a return put back, a price edit, a bulk reprice, a store
 * reinstated — and a rule that has to be remembered at every door is the
 * arrangement where one forgets. Measuring is never allowed to stop the act:
 * a failure to read is the act alone.
 */
export async function withProductAlerts<T>(productIds: readonly (number | null | undefined)[], act: () => Promise<T>, now = new Date()): Promise<T> {
  const ids = [...new Set(productIds.filter((id): id is number => typeof id === "number"))];
  const db = await getDb();
  if (!db || !ids.length) return act();
  const before = await productStates(db, ids).catch(() => null);
  const result = await act();
  if (before) await tellFollowers(db, ids, before, now).catch(error => console.error(`[notices] product alerts failed: ${describeError(error)}`));
  return result;
}

async function tellFollowers(db: Db, ids: number[], before: Map<number, ProductState>, now: Date): Promise<void> {
  const after = await productStates(db, ids);
  const back = ids.filter(id => before.has(id) && after.has(id) && cameBack(before.get(id)!, after.get(id)!));
  const cheaper = ids.filter(id => before.has(id) && after.has(id) && priceFell(before.get(id)!, after.get(id)!));
  if (!back.length && !cheaper.length) return;

  const followers = await db
    .select()
    .from(followedProducts)
    .where(inArray(followedProducts.productId, [...new Set([...back, ...cheaper])].map(String)));
  const notices: Notice[] = [];
  const priced: { id: number; price: string }[] = [];
  for (const follow of followers) {
    const id = Number(follow.productId);
    const state = after.get(id);
    if (!state) continue;
    const params = { product: state.title, productAr: state.titleAr ?? "", price: state.lowestFils === null ? "" : fromFils(state.lowestFils) };
    const link = `/products/${state.handle}`;
    if (back.includes(id) && follow.backInStock) {
      notices.push({ userId: follow.userId, kind: "back_in_stock", params, link, dedupe: dedupe.backInStock(id, now) });
    }
    if (cheaper.includes(id) && follow.priceDrop && state.lowestFils !== null) {
      /* Below the last price this follower was told about, too: a price that
         falls, rises and falls back to where it was is not news twice. */
      const told = follow.lastNotifiedPrice ? toFils(follow.lastNotifiedPrice) : null;
      if (told === null || state.lowestFils < told) {
        notices.push({ userId: follow.userId, kind: "price_drop", params, link, dedupe: dedupe.priceDrop(id, state.lowestFils, now) });
        priced.push({ id: follow.id, price: fromFils(state.lowestFils) });
      }
    }
  }
  await notify(notices);
  for (const row of priced) {
    await db.update(followedProducts).set({ lastNotifiedPrice: row.price }).where(eq(followedProducts.id, row.id));
  }
}

/**
 * A store published something: once a week at most, the shoppers who bought
 * from it in the last six months hear that it has something new. In the
 * inbox only (`new_arrival` is never emailed), and silenced by the
 * preference that has said "New arrivals" on the account page all along.
 */
export async function tellPastBuyers(vendorId: number, now = new Date()): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const since = new Date(now.getTime() - 180 * 86_400_000);
    const [store] = await db.select({ name: vendors.name, nameAr: vendors.nameAr, slug: vendors.slug }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
    if (!store) return;
    const buyers = await db
      .selectDistinct({ userId: orders.userId })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.vendorId, vendorId), isNotNull(orders.userId), gte(orders.placedAt, since)))
      .limit(500);
    await notifyQuietly(buyers.flatMap(row => row.userId === null ? [] : [{
      userId: row.userId,
      kind: "new_arrival" as const,
      params: { store: store.name, storeAr: store.nameAr ?? "" },
      link: `/stores/${store.slug}`,
      dedupe: dedupe.newArrival(vendorId, now),
    }]));
  } catch (error) {
    console.error(`[notices] new arrivals for store ${vendorId} failed: ${describeError(error)}`);
  }
}

/* ---------------------------------------------------------------- bags --- */

/**
 * One reminder per basket left between `ABANDON_AFTER_HOURS` and
 * `STALE_AFTER_DAYS` — the same window the bag's own banner uses
 * (`cartRecovery.ts`), so the email and the page cannot disagree about which
 * baskets are forgotten. Only an account's basket: a guest's has nobody to
 * tell. Touching the basket makes it a new one to remind about.
 */
export async function remindAbandonedBags(now = new Date(), limit = 500): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const newest = new Date(now.getTime() - 6 * 3_600_000);
  const oldest = new Date(now.getTime() - 14 * 86_400_000);
  const rows = await db
    .select({ id: carts.id, userId: carts.userId, updatedAt: carts.updatedAt, items: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int` })
    .from(carts)
    .innerJoin(cartItems, eq(cartItems.cartId, carts.id))
    .where(and(isNotNull(carts.userId), lte(carts.updatedAt, newest), gte(carts.updatedAt, oldest)))
    .groupBy(carts.id)
    .limit(limit);
  const notices: Notice[] = [];
  for (const row of rows) {
    if (row.userId === null) continue;
    const recovery = recoveryFor({ updatedAt: row.updatedAt, itemCount: row.items }, now);
    if (!recovery.remind) continue;
    notices.push({ userId: row.userId, kind: "bag_reminder", params: { count: recovery.itemCount }, link: "/cart", dedupe: dedupe.bag(row.id, row.updatedAt) });
  }
  return notices.length ? notify(notices) : 0;
}

/* -------------------------------------------------------------- orders --- */

async function lineNames(db: Db, lineIds: number[]): Promise<Map<number, { product: string; productAr: string }>> {
  const names = new Map<number, { product: string; productAr: string }>();
  if (!lineIds.length) return names;
  const rows = await db
    .select({ id: orderItems.id, title: orderItems.productTitle, titleAr: products.titleAr })
    .from(orderItems)
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(inArray(orderItems.id, lineIds));
  /* The frozen title, which is what the shopper bought; today's Arabic title
     beside it when the product still has one. */
  for (const row of rows) names.set(row.id, { product: row.title, productAr: row.titleAr ?? "" });
  return names;
}

const orderLink = (reference: string) => `/account/orders?order=${encodeURIComponent(reference)}`;

/**
 * An order's lines moved: the shopper hears it is on the way when the first
 * parcel leaves, and that it was delivered only once everything still coming
 * has arrived — "delivered" while a second parcel is in a van is the sentence
 * `orderProgress` exists to avoid.
 */
export async function tellOrderMoved(orderId: number, to: string): Promise<void> {
  if (to !== "shipped" && to !== "delivered") return;
  try {
    const db = await getDb();
    if (!db) return;
    const [order] = await db.select({ reference: orders.reference, userId: orders.userId }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order?.userId) return;
    if (to === "shipped") {
      await notifyQuietly({ userId: order.userId, kind: "order_on_the_way", params: { reference: order.reference }, link: orderLink(order.reference), dedupe: dedupe.order(order.reference, "shipped") });
      return;
    }
    const lines = await db.select({ fulfilment: orderItems.fulfilment }).from(orderItems).where(eq(orderItems.orderId, orderId));
    const coming = lines.filter(line => line.fulfilment !== "cancelled" && line.fulfilment !== "returned");
    if (!coming.length || coming.some(line => line.fulfilment !== "delivered")) return;
    await notifyQuietly({ userId: order.userId, kind: "order_delivered", params: { reference: order.reference }, link: orderLink(order.reference), dedupe: dedupe.order(order.reference, "delivered") });
  } catch (error) {
    console.error(`[notices] order ${orderId} move not told: ${describeError(error)}`);
  }
}

/** A seller cancelled a line the shopper is waiting for. */
export async function tellLineCancelled(lineId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const [line] = await db
      .select({ reference: orders.reference, userId: orders.userId })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(orderItems.id, lineId))
      .limit(1);
    if (!line?.userId) return;
    const names = (await lineNames(db, [lineId])).get(lineId);
    await notifyQuietly({
      userId: line.userId,
      kind: "line_cancelled",
      params: { reference: line.reference, ...(names ?? { product: "" }) },
      link: orderLink(line.reference),
      dedupe: dedupe.line(lineId, "cancelled"),
    });
  } catch (error) {
    console.error(`[notices] cancelled line ${lineId} not told: ${describeError(error)}`);
  }
}

/** The order exists: the shopper's receipt, and each store's new-order bell. */
export async function tellOrderPlaced(order: { id: number; reference: string; userId: number | null }, vendorIds: readonly (number | null)[]): Promise<void> {
  if (order.userId) {
    await notifyQuietly({ userId: order.userId, kind: "order_placed", params: { reference: order.reference }, link: orderLink(order.reference), dedupe: dedupe.order(order.reference, "placed") });
  }
  for (const vendorId of new Set(vendorIds.filter((id): id is number => typeof id === "number"))) {
    await notifyStore(vendorId, { kind: "seller_new_order", params: { reference: order.reference }, link: "/admin/orders", dedupe: dedupe.order(order.reference, `new:${vendorId}`) });
  }
}

/** What a return came to, for the shopper and — when it is asked for — the store. */
export async function tellReturn(
  requestId: number,
  event: "requested" | "approved" | "declined" | "refundPaid" | "exchanged",
  extra: { amount?: string; replacementReference?: string } = {},
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const [row] = await db
      .select({ lineId: returnRequests.orderItemId, reference: orders.reference, userId: orders.userId, vendorId: orderItems.vendorId })
      .from(returnRequests)
      .innerJoin(orderItems, eq(orderItems.id, returnRequests.orderItemId))
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(returnRequests.id, requestId))
      .limit(1);
    if (!row) return;
    const names = (await lineNames(db, [row.lineId])).get(row.lineId) ?? { product: "", productAr: "" };
    const link = orderLink(row.reference);
    if (event === "requested") {
      if (row.vendorId) await notifyStore(row.vendorId, { kind: "seller_return", params: { reference: row.reference, ...names }, link: "/admin/returns", dedupe: dedupe.returnRequest(requestId, "requested") });
      return;
    }
    if (!row.userId) return;
    if (event === "approved" || event === "declined") {
      await notifyQuietly({ userId: row.userId, kind: event === "approved" ? "return_approved" : "return_declined", params: names, link, dedupe: dedupe.returnRequest(requestId, event) });
    } else if (event === "refundPaid") {
      await notifyQuietly({ userId: row.userId, kind: "refund_done", params: { ...names, amount: extra.amount ?? "" }, link, dedupe: dedupe.returnRequest(requestId, "refundPaid") });
    } else if (extra.replacementReference) {
      await notifyQuietly({
        userId: row.userId,
        kind: "exchange_sent",
        params: { ...names, reference: extra.replacementReference },
        link: orderLink(extra.replacementReference),
        dedupe: dedupe.returnRequest(requestId, "exchanged"),
      });
    }
  } catch (error) {
    console.error(`[notices] return ${requestId} not told: ${describeError(error)}`);
  }
}

/* ---------------------------------------------------------- price asks --- */

/** A seller answered a price request, either way. */
export async function tellOfferAnswered(offerId: number, state: "offered" | "declined"): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const [row] = await db
      .select({ userId: priceOffers.userId, product: products.title, productAr: products.titleAr, store: vendors.name, storeAr: vendors.nameAr })
      .from(priceOffers)
      .innerJoin(productVariants, eq(productVariants.id, priceOffers.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(vendors, eq(vendors.id, products.vendorId))
      .where(eq(priceOffers.id, offerId))
      .limit(1);
    if (!row) return;
    await notifyQuietly({
      userId: row.userId,
      kind: "offer_answered",
      params: { product: row.product, productAr: row.productAr ?? "", store: row.store, storeAr: row.storeAr ?? "" },
      link: "/account/offers",
      dedupe: dedupe.offer(offerId, state),
    });
  } catch (error) {
    console.error(`[notices] price request ${offerId} not told: ${describeError(error)}`);
  }
}

/** NetLet wrote back in a support conversation. One a day per conversation is enough to bring somebody back. */
export async function tellSupportAnswered(conversationId: number, now = new Date()): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const [row] = await db.select({ userId: supportConversations.userId }).from(supportConversations).where(eq(supportConversations.id, conversationId)).limit(1);
    if (!row) return;
    await notifyQuietly({ userId: row.userId, kind: "support_answered", link: "/account/help", dedupe: dedupe.thread("support", conversationId, now) });
  } catch (error) {
    console.error(`[notices] support reply ${conversationId} not told: ${describeError(error)}`);
  }
}

/* ------------------------------------------------- product alert doors --- */

/** The products some variants belong to. */
async function productsOfVariants(db: Db, variantIds: readonly number[]): Promise<number[]> {
  const ids = [...new Set(variantIds)].filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return [];
  const rows = await db.select({ productId: productVariants.productId }).from(productVariants).where(inArray(productVariants.id, ids));
  return [...new Set(rows.map(row => row.productId))];
}

/** `withProductAlerts`, for an act that names variants rather than products. */
export async function withVariantAlerts<T>(variantIds: readonly number[], act: () => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) return act();
  const productIds = await productsOfVariants(db, variantIds).catch(() => [] as number[]);
  return withProductAlerts(productIds, act);
}

/** `withProductAlerts` over a whole store's shelf — a store reinstated is every product of it back. */
export async function withStoreAlerts<T>(vendorId: number, act: () => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) return act();
  const rows = await db.select({ id: products.id }).from(products).where(eq(products.vendorId, vendorId)).limit(2000).catch(() => [] as { id: number }[]);
  return withProductAlerts(rows.map(row => row.id), act);
}

/** `withVariantAlerts` over the variants on an inbound shipment's lines. */
export async function withShipmentAlerts<T>(shipmentId: number, act: () => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) return act();
  const rows = await db.select({ variantId: inboundLines.variantId }).from(inboundLines).where(eq(inboundLines.shipmentId, shipmentId)).catch(() => [] as { variantId: number | null }[]);
  return withVariantAlerts(rows.flatMap(row => row.variantId === null ? [] : [row.variantId]), act);
}
