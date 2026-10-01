/**
 * Shoppers and sellers talking (3.8).
 *
 * `shared/commerce/contactFilter.ts` is the rule that matters and is pure; this
 * is the part that needs a database. Outside `db.ts` for the reason every
 * testable module is.
 *
 * **Every message goes through the filter here, whatever the page did.** The
 * composer runs the same function as somebody types, so an honest client never
 * sends a refused message — which is exactly why the server cannot rely on it.
 *
 * **Scope is in the query.** A shopper reads the conversations where they are
 * the shopper; a seller reads the conversations of their own store, at any
 * rank that clears `chat.answer`; an administrator reads all of them, because
 * a filter is mitigation and a moderator is what catches the rest. A
 * conversation id is a serial, so "show me conversation 4" has to be refused by
 * the `WHERE`, not by a check a second caller skips — and refused as *not
 * found*, so walking ids does not reveal which exist.
 *
 * **The shopper is named the way a review names them**: first name and an
 * initial, never an email. A seller needs something to address them by; they do
 * not need a way to reach them somewhere else, which is the whole point of the
 * filter.
 */
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { conversationMessages, conversations, orderItems, orders, products, users, vendors } from "../drizzle/schema.js";
import { contactFindings, MAX_MESSAGE_LENGTH, type ContactKind } from "../shared/commerce/contactFilter.js";
import { assertCan, can, type Actor } from "../shared/inventory/permissions.js";
import { checkMessageAllowed, recordMessage } from "./rateLimit.js";
import { displayName } from "./reviews.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type ChatRefusal =
  | "chat.offPlatform"
  | "chat.empty"
  | "chat.tooLong"
  | "chat.notFound"
  | "chat.storeClosed"
  | "chat.needsSubject"
  | "chat.tooMany";

export class ChatRefused extends Error {
  constructor(readonly reason: ChatRefusal, readonly found: ContactKind[] = [], readonly retryAfterSeconds?: number) {
    super(reason);
    this.name = "ChatRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/** A message as it will be stored, or the reason it will not be. */
function cleanBody(body: string): string {
  const text = body.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new ChatRefused("chat.empty");
  if (text.length > MAX_MESSAGE_LENGTH) throw new ChatRefused("chat.tooLong");
  const found = contactFindings(text);
  if (found.length > 0) throw new ChatRefused("chat.offPlatform", found);
  return text;
}

/* ---------------------------------------------------------- the shopper --- */

export type ShopperSend = {
  /** An existing conversation of theirs. */
  conversationId?: number;
  /** Or: start (or continue) one about a product, which names the store. */
  productId?: number;
  /** Or: about one of their orders, with the store whose lines it holds. */
  orderReference?: string;
  vendorId?: number;
  body: string;
};

/**
 * Send a message as the shopper, opening the conversation if there is none.
 *
 * The store is resolved from what the message is about — a published product,
 * or one of the shopper's own orders holding that store's lines — rather than
 * from a vendor id alone, so a shopper cannot open a thread with a suspended
 * store, and a message "about order NL-…" is about an order that is theirs.
 */
export async function sendAsShopper(user: { id: number; email: string | null }, input: ShopperSend): Promise<{ conversationId: number }> {
  const body = cleanBody(input.body);

  const verdict = await checkMessageAllowed(user.email);
  if (!verdict.allowed) throw new ChatRefused("chat.tooMany", [], verdict.retryAfterSeconds);

  const db = await handle();
  let vendorId: number;
  let productId: number | null = null;
  let productTitle: string | null = null;
  let orderId: number | null = null;

  if (input.conversationId !== undefined) {
    const [mine] = await db
      .select({ vendorId: conversations.vendorId })
      .from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, user.id)))
      .limit(1);
    if (!mine) throw new ChatRefused("chat.notFound");
    vendorId = mine.vendorId;
  } else if (input.productId !== undefined) {
    const [product] = await db
      .select({ id: products.id, title: products.title, vendorId: products.vendorId, status: products.status })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1);
    /* A draft is not something a shopper can have seen, so it is not found. */
    if (!product || product.status !== "published") throw new ChatRefused("chat.notFound");
    vendorId = product.vendorId;
    productId = product.id;
    productTitle = product.title;
  } else if (input.orderReference !== undefined && input.vendorId !== undefined) {
    const [order] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.reference, input.orderReference), eq(orders.userId, user.id)))
      .limit(1);
    if (!order) throw new ChatRefused("chat.notFound");
    const [line] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, order.id), eq(orderItems.vendorId, input.vendorId)))
      .limit(1);
    if (!line) throw new ChatRefused("chat.notFound");
    vendorId = input.vendorId;
    orderId = order.id;
  } else {
    throw new ChatRefused("chat.needsSubject");
  }

  const [store] = await db.select({ status: vendors.status }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  /* A suspended store has had its shelf emptied; a conversation opening with
     it is a sale being arranged around the suspension. Existing threads stay
     readable, but nothing new is sent to it. */
  if (!store || store.status !== "approved") throw new ChatRefused("chat.storeClosed");

  const now = new Date();
  const [thread] = await db
    .insert(conversations)
    .values({ userId: user.id, vendorId, lastMessageAt: now, shopperReadAt: now })
    .onConflictDoUpdate({
      target: [conversations.userId, conversations.vendorId],
      set: { lastMessageAt: now, shopperReadAt: now },
    })
    .returning({ id: conversations.id });

  await db.insert(conversationMessages).values({
    conversationId: thread.id,
    side: "shopper",
    authorId: user.id,
    body,
    productId,
    productTitle,
    orderId,
    createdAt: now,
  });
  await recordMessage(user.email);
  return { conversationId: thread.id };
}

export type ConversationSummary = {
  id: number;
  /** The other party: the store's name for a shopper, the shopper's short name for a store. */
  counterpart: string;
  vendorId: number;
  lastMessageAt: Date;
  preview: string | null;
  previewSide: string | null;
  unread: number;
};

async function summaries(db: Db, rows: { id: number; vendorId: number; counterpart: string; lastMessageAt: Date }[], mySide: "shopper" | "seller") {
  if (rows.length === 0) return [] as ConversationSummary[];
  const ids = rows.map(row => row.id);

  /* The latest message of each thread, in one query. */
  const latest = await db
    .selectDistinctOn([conversationMessages.conversationId], {
      conversationId: conversationMessages.conversationId,
      body: conversationMessages.body,
      side: conversationMessages.side,
    })
    .from(conversationMessages)
    .where(inArray(conversationMessages.conversationId, ids))
    .orderBy(conversationMessages.conversationId, desc(conversationMessages.createdAt), desc(conversationMessages.id));

  /* Unread is everything from the other side since this side last looked —
     one grouped query, against whichever read-stamp is this side's. */
  const readAt = mySide === "shopper" ? conversations.shopperReadAt : conversations.vendorReadAt;
  const counted = await db
    .select({ conversationId: conversationMessages.conversationId, n: sql<number>`count(*)::int` })
    .from(conversationMessages)
    .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
    .where(and(
      inArray(conversationMessages.conversationId, ids),
      ne(conversationMessages.side, mySide),
      or(isNull(readAt), gt(conversationMessages.createdAt, readAt)),
    ))
    .groupBy(conversationMessages.conversationId);
  const unread = new Map(counted.map(row => [row.conversationId, row.n]));

  return rows.map(row => {
    const last = latest.find(message => message.conversationId === row.id);
    return {
      id: row.id,
      counterpart: row.counterpart,
      vendorId: row.vendorId,
      lastMessageAt: row.lastMessageAt,
      preview: last ? last.body.slice(0, 140) : null,
      previewSide: last?.side ?? null,
      unread: unread.get(row.id) ?? 0,
    };
  });
}

/** How many threads a list reads. An inbox page, newest first. */
export const INBOX_PAGE = 50;

/** The shopper's conversations, newest first. */
export async function conversationsForShopper(userId: number): Promise<ConversationSummary[]> {
  const db = await handle();
  const rows = await db
    .select({
      id: conversations.id,
      vendorId: conversations.vendorId,
      counterpart: vendors.name,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .innerJoin(vendors, eq(vendors.id, conversations.vendorId))
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(INBOX_PAGE);
  return summaries(db, rows, "shopper");
}

/* ------------------------------------------------------------ the seller --- */

/** A store's conversations, or every store's for an administrator. */
export async function conversationsForSeller(actor: Actor): Promise<(ConversationSummary & { vendorName: string })[]> {
  assertCan(actor, "chat.answer", actor.kind === "vendor" ? actor.vendorId : undefined);
  const db = await handle();
  const rows = await db
    .select({
      id: conversations.id,
      vendorId: conversations.vendorId,
      vendorName: vendors.name,
      shopperName: users.name,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .innerJoin(vendors, eq(vendors.id, conversations.vendorId))
    .innerJoin(users, eq(users.id, conversations.userId))
    .where(actor.kind === "vendor" ? eq(conversations.vendorId, actor.vendorId) : undefined)
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(INBOX_PAGE);

  const listed = await summaries(
    db,
    rows.map(row => ({ ...row, counterpart: displayName(row.shopperName) })),
    "seller",
  );
  return listed.map(row => ({ ...row, vendorName: rows.find(one => one.id === row.id)?.vendorName ?? "" }));
}

/** Reply as the store. Any rank that clears `chat.answer` on that store. */
export async function sendAsSeller(actor: Actor, conversationId: number, rawBody: string): Promise<void> {
  const body = cleanBody(rawBody);
  const db = await handle();
  const [thread] = await db
    .select({ vendorId: conversations.vendorId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!thread) throw new ChatRefused("chat.notFound");
  /* Not their store's conversation: not found, never "forbidden", so a seller
     walking ids learns nothing about which exist. An administrator reads every
     thread but does not answer as a store they do not belong to. */
  if (actor.kind !== "vendor" || actor.vendorId !== thread.vendorId) throw new ChatRefused("chat.notFound");
  assertCan(actor, "chat.answer", thread.vendorId);

  const now = new Date();
  await db.insert(conversationMessages).values({ conversationId, side: "seller", authorId: actor.userId, body, createdAt: now });
  await db.update(conversations).set({ lastMessageAt: now, vendorReadAt: now }).where(eq(conversations.id, conversationId));
}

/* ------------------------------------------------------------ the thread --- */

export type ThreadMessage = {
  id: number;
  side: string;
  body: string;
  createdAt: Date;
  productId: number | null;
  productTitle: string | null;
  orderReference: string | null;
};

export type Thread = {
  id: number;
  vendorId: number;
  vendorName: string;
  shopperName: string;
  messages: ThreadMessage[];
};

/** How many messages a thread reads. The newest; older ones are history. */
export const THREAD_PAGE = 200;

/**
 * One conversation, as whoever is asking may see it — and marked read for
 * their side. An administrator reading a thread marks nothing: a moderator
 * looking is not the store having answered.
 */
export async function openThread(
  viewer: { kind: "shopper"; userId: number } | { kind: "actor"; actor: Actor },
  conversationId: number,
): Promise<Thread> {
  const db = await handle();

  let scope;
  if (viewer.kind === "shopper") scope = eq(conversations.userId, viewer.userId);
  else {
    const actor = viewer.actor;
    assertCan(actor, "chat.answer", actor.kind === "vendor" ? actor.vendorId : undefined);
    scope = actor.kind === "vendor" ? eq(conversations.vendorId, actor.vendorId) : undefined;
  }

  const [thread] = await db
    .select({ id: conversations.id, vendorId: conversations.vendorId, vendorName: vendors.name, shopperName: users.name })
    .from(conversations)
    .innerJoin(vendors, eq(vendors.id, conversations.vendorId))
    .innerJoin(users, eq(users.id, conversations.userId))
    .where(and(eq(conversations.id, conversationId), scope))
    .limit(1);
  if (!thread) throw new ChatRefused("chat.notFound");

  const newest = await db
    .select({
      id: conversationMessages.id,
      side: conversationMessages.side,
      body: conversationMessages.body,
      createdAt: conversationMessages.createdAt,
      productId: conversationMessages.productId,
      productTitle: conversationMessages.productTitle,
      orderReference: orders.reference,
    })
    .from(conversationMessages)
    .leftJoin(orders, eq(orders.id, conversationMessages.orderId))
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
    .limit(THREAD_PAGE);

  const now = new Date();
  if (viewer.kind === "shopper") {
    await db.update(conversations).set({ shopperReadAt: now }).where(eq(conversations.id, conversationId));
  } else if (viewer.actor.kind === "vendor") {
    await db.update(conversations).set({ vendorReadAt: now }).where(eq(conversations.id, conversationId));
  }

  return {
    id: thread.id,
    vendorId: thread.vendorId,
    vendorName: thread.vendorName,
    shopperName: displayName(thread.shopperName),
    messages: newest.reverse(),
  };
}

/** Unread messages waiting on a shopper, for a badge that hides at zero. */
export async function unreadForShopper(userId: number): Promise<number> {
  const db = await handle();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversationMessages)
    .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
    .where(and(
      eq(conversations.userId, userId),
      eq(conversationMessages.side, "seller"),
      or(isNull(conversations.shopperReadAt), gt(conversationMessages.createdAt, conversations.shopperReadAt)),
    ));
  return row?.n ?? 0;
}

/** Conversations a store has not caught up on, for the overview tile. */
export async function unreadForSeller(actor: Actor): Promise<number> {
  if (actor.kind !== "vendor" || !can(actor, "chat.answer", actor.vendorId)) return 0;
  const db = await handle();
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${conversations.id})::int` })
    .from(conversationMessages)
    .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
    .where(and(
      eq(conversations.vendorId, actor.vendorId),
      eq(conversationMessages.side, "shopper"),
      or(isNull(conversations.vendorReadAt), gt(conversationMessages.createdAt, conversations.vendorReadAt)),
    ));
  return row?.n ?? 0;
}

