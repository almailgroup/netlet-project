/**
 * Talking to NetLet (3.5.1), the database half. The rules — state, the
 * automatic first answer — are `Shared/commerce/support.ts`.
 *
 * **A shopper's conversations are scoped by account inside every query**; an
 * id is a serial, so another shopper's is "not found". **Answering is NetLet's
 * alone** — `support.answer`, which no vendor rank reaches: this is the shop
 * talking, and a seller is a party to many of these complaints.
 *
 * The automatic answer reads the order through `getOrderForUser` and the
 * return rule through `returnStateFor` — the same reads the account page makes
 * — so it cannot tell a shopper something the page beside it contradicts.
 */
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { supportConversations, supportMessages, users } from "../../database/schema.js";
import { RETURN_WINDOW_DAYS, returnStateFor } from "../../../Shared/commerce/returns.js";
import {
  MAX_OPEN_CONVERSATIONS,
  MAX_SUPPORT_MESSAGES_PER_HOUR,
  firstAnswer,
  messageProblem,
  nextStatus,
  type AnswerFacts,
  type AnswerPart,
  type SupportStatus,
  type SupportTopic,
} from "../../../Shared/commerce/support.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../../../Shared/pagination.js";
import { getOrderForUser } from "./orders.js";
import { getDb } from "./db.js";
import { translate } from "../../../Shared/i18n/dictionary.js";
import type { DraftTurn } from "../../../Shared/commerce/supportDraft.js";
import { tellSupportAnswered } from "./notifications.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type SupportRefusal = "support.empty" | "support.tooLong" | "support.notFound" | "support.unknownOrder" | "support.tooManyOpen" | "support.tooMany";

export class SupportRefused extends Error {
  constructor(readonly reason: SupportRefusal) {
    super(reason);
    this.name = "SupportRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/** A shopper's hourly message ceiling, counted across every conversation. */
async function assertUnderCeiling(db: Db, userId: number, now: Date) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportMessages)
    .where(and(eq(supportMessages.authorId, userId), eq(supportMessages.author, "shopper"), gt(supportMessages.createdAt, new Date(now.getTime() - 3_600_000))));
  if (count >= MAX_SUPPORT_MESSAGES_PER_HOUR) throw new SupportRefused("support.tooMany");
}

function checked(body: string): string {
  const problem = messageProblem(body);
  if (problem) throw new SupportRefused(problem);
  return body.trim();
}

type OrderFacts = NonNullable<AnswerFacts["order"]>;

/**
 * One of the shopper's own orders as the automatic answer reads it, or null
 * when the reference is not theirs. Read the same way the account page reads
 * it, so the answer cannot contradict the page beside it.
 */
async function orderFacts(userId: number, reference: string, now: Date): Promise<{ orderId: number; facts: OrderFacts } | null> {
  const found = await getOrderForUser(userId, reference);
  if (!found) return null;
  return {
    orderId: found.order.id,
    facts: {
      reference: found.order.reference,
      paymentMethod: found.order.paymentMethod ?? null,
      paid: found.order.status === "paid",
      lines: found.lines.map(line => ({
        fulfilment: line.fulfilment,
        returnable: returnStateFor(found.order, { fulfilment: line.fulfilment, deliveredAt: line.deliveredAt }, now).returnable,
      })),
    },
  };
}

/** Open a conversation, and answer it at once from the facts. */
export async function openConversation(userId: number, input: { topic: SupportTopic; orderReference?: string | null; body: string }, now = new Date()) {
  const body = checked(input.body);
  const db = await handle();
  await assertUnderCeiling(db, userId, now);

  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(supportConversations)
    .where(and(eq(supportConversations.userId, userId), ne(supportConversations.status, "resolved")));
  if (open >= MAX_OPEN_CONVERSATIONS) throw new SupportRefused("support.tooManyOpen");

  let facts: OrderFacts | null = null;
  let orderId: number | null = null;
  if (input.orderReference) {
    const found = await orderFacts(userId, input.orderReference, now);
    if (!found) throw new SupportRefused("support.unknownOrder");
    ({ orderId, facts } = found);
  }
  const answer = firstAnswer(input.topic, { order: facts, returnWindowDays: RETURN_WINDOW_DAYS });

  return db.transaction(async tx => {
    const [conversation] = await tx
      .insert(supportConversations)
      .values({ userId, topic: input.topic, orderId, orderReference: facts?.reference ?? null, lastMessageAt: now, shopperReadAt: now })
      .returning({ id: supportConversations.id });
    await tx.insert(supportMessages).values([
      { conversationId: conversation.id, author: "shopper", authorId: userId, body, createdAt: now },
      /* A moment later, so it reads after the question it answers. */
      { conversationId: conversation.id, author: "automatic", answer, createdAt: new Date(now.getTime() + 1) },
    ]);
    return { id: conversation.id };
  });
}

export type SupportSummary = {
  id: number;
  topic: SupportTopic;
  orderReference: string | null;
  status: SupportStatus;
  lastMessageAt: Date;
  unread: boolean;
};

/** The shopper's conversations, newest activity first. */
export async function myConversations(userId: number): Promise<SupportSummary[]> {
  const db = await handle();
  const rows = await db
    .select()
    .from(supportConversations)
    .where(eq(supportConversations.userId, userId))
    .orderBy(desc(supportConversations.lastMessageAt), desc(supportConversations.id))
    .limit(50);
  const staffLast = await lastStaffMessage(db, rows.map(row => row.id));
  return rows.map(row => ({
    id: row.id,
    topic: row.topic,
    orderReference: row.orderReference,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    unread: Boolean(staffLast.get(row.id) && (!row.shopperReadAt || staffLast.get(row.id)! > row.shopperReadAt)),
  }));
}

async function lastStaffMessage(db: Db, ids: number[]): Promise<Map<number, Date>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: supportMessages.conversationId, at: sql<Date>`max(${supportMessages.createdAt})` })
    .from(supportMessages)
    .where(and(inArray(supportMessages.conversationId, ids), eq(supportMessages.author, "staff")))
    .groupBy(supportMessages.conversationId);
  return new Map(rows.map(row => [row.id, new Date(row.at)]));
}

export type SupportThread = {
  id: number;
  topic: SupportTopic;
  orderReference: string | null;
  status: SupportStatus;
  shopperName: string | null;
  messages: { id: number; author: "shopper" | "staff" | "automatic"; body: string | null; answer: AnswerPart[] | null; createdAt: Date }[];
};

async function thread(db: Db, conversation: typeof supportConversations.$inferSelect, shopperName: string | null): Promise<SupportThread> {
  const messages = await db
    .select({ id: supportMessages.id, author: supportMessages.author, body: supportMessages.body, answer: supportMessages.answer, createdAt: supportMessages.createdAt })
    .from(supportMessages)
    .where(eq(supportMessages.conversationId, conversation.id))
    .orderBy(asc(supportMessages.createdAt), asc(supportMessages.id));
  return {
    id: conversation.id,
    topic: conversation.topic,
    orderReference: conversation.orderReference,
    status: conversation.status,
    shopperName,
    messages: messages.map(message => ({ ...message, author: message.author as "shopper" | "staff" | "automatic" })),
  };
}

/** One of the shopper's own conversations; opening it marks it read for them. */
export async function conversationForShopper(userId: number, id: number, now = new Date()): Promise<SupportThread> {
  const db = await handle();
  const [conversation] = await db.select().from(supportConversations).where(and(eq(supportConversations.id, id), eq(supportConversations.userId, userId))).limit(1);
  if (!conversation) throw new SupportRefused("support.notFound");
  await db.update(supportConversations).set({ shopperReadAt: now }).where(eq(supportConversations.id, id));
  return thread(db, conversation, null);
}

/** The shopper writes again; a resolved conversation reopens, because they are still asking. */
export async function replyAsShopper(userId: number, id: number, rawBody: string, now = new Date()) {
  const body = checked(rawBody);
  const db = await handle();
  await assertUnderCeiling(db, userId, now);
  const [conversation] = await db.select().from(supportConversations).where(and(eq(supportConversations.id, id), eq(supportConversations.userId, userId))).limit(1);
  if (!conversation) throw new SupportRefused("support.notFound");
  await db.insert(supportMessages).values({ conversationId: id, author: "shopper", authorId: userId, body, createdAt: now });
  await db.update(supportConversations)
    .set({ status: nextStatus(conversation.status, "shopperWrote"), lastMessageAt: now, shopperReadAt: now })
    .where(eq(supportConversations.id, id));
}

/** "This answered it": the shopper may close their own. */
export async function resolveAsShopper(userId: number, id: number) {
  const db = await handle();
  const [row] = await db.update(supportConversations).set({ status: "resolved" }).where(and(eq(supportConversations.id, id), eq(supportConversations.userId, userId))).returning({ id: supportConversations.id });
  if (!row) throw new SupportRefused("support.notFound");
}

/** How many of the shopper's conversations have a staff reply they have not opened. */
export async function unreadForShopper(userId: number): Promise<number> {
  return (await myConversations(userId)).filter(row => row.unread).length;
}

/* ------------------------------------------------------------ NetLet's side --- */

export type InboxRow = SupportSummary & { shopperEmail: string | null };

/**
 * The inbox: open conversations first — the ones waiting on NetLet — then the
 * rest, by latest activity; filtered on the server and paged, like every admin
 * list.
 */
export async function inbox(actor: Actor, request: { status?: SupportStatus; page?: number; pageSize?: number } = {}): Promise<Page<InboxRow>> {
  assertCan(actor, "support.answer");
  const db = await handle();
  const pageSize = clampPageSize(request.pageSize ?? 20);
  const filter = request.status ? eq(supportConversations.status, request.status) : undefined;
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(supportConversations).where(filter);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);
  const rows = await db
    .select({ conversation: supportConversations, email: users.email })
    .from(supportConversations)
    .leftJoin(users, eq(supportConversations.userId, users.id))
    .where(filter)
    .orderBy(sql`${supportConversations.status} = 'open' desc`, desc(supportConversations.lastMessageAt), desc(supportConversations.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));
  return {
    rows: rows.map(({ conversation, email }) => ({
      id: conversation.id,
      topic: conversation.topic,
      orderReference: conversation.orderReference,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt,
      /* Unread for NetLet: the shopper wrote after staff last looked. */
      unread: conversation.status === "open" && (!conversation.staffReadAt || conversation.lastMessageAt > conversation.staffReadAt),
      shopperEmail: email,
    })),
    total,
    page,
    pageSize,
  };
}

/** One conversation for NetLet; opening it marks it read for staff. */
export async function conversationForStaff(actor: Actor, id: number, now = new Date()): Promise<SupportThread & { shopperEmail: string | null }> {
  assertCan(actor, "support.answer");
  const db = await handle();
  const [row] = await db
    .select({ conversation: supportConversations, email: users.email, name: users.name })
    .from(supportConversations)
    .leftJoin(users, eq(supportConversations.userId, users.id))
    .where(eq(supportConversations.id, id))
    .limit(1);
  if (!row) throw new SupportRefused("support.notFound");
  await db.update(supportConversations).set({ staffReadAt: now }).where(eq(supportConversations.id, id));
  return { ...(await thread(db, row.conversation, row.name)), shopperEmail: row.email };
}

export async function replyAsStaff(actor: Actor, id: number, rawBody: string, now = new Date()) {
  assertCan(actor, "support.answer");
  const body = checked(rawBody);
  const db = await handle();
  const [conversation] = await db.select().from(supportConversations).where(eq(supportConversations.id, id)).limit(1);
  if (!conversation) throw new SupportRefused("support.notFound");
  await db.insert(supportMessages).values({ conversationId: id, author: "staff", authorId: actor.userId, body, createdAt: now });
  await db.update(supportConversations)
    .set({ status: nextStatus(conversation.status, "staffWrote"), lastMessageAt: now, staffReadAt: now })
    .where(eq(supportConversations.id, id));
  await tellSupportAnswered(id, now);
}

export async function resolveAsStaff(actor: Actor, id: number) {
  assertCan(actor, "support.answer");
  const db = await handle();
  const [row] = await db.update(supportConversations).set({ status: "resolved" }).where(eq(supportConversations.id, id)).returning({ id: supportConversations.id });
  if (!row) throw new SupportRefused("support.notFound");
}

/** How many conversations are waiting on NetLet, for a tile that hides at zero. */
export async function waitingOnStaff(actor: Actor): Promise<number> {
  assertCan(actor, "support.answer");
  const db = await handle();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportConversations)
    .where(and(eq(supportConversations.status, "open"), or(isNull(supportConversations.staffReadAt), gt(supportConversations.lastMessageAt, supportConversations.staffReadAt))));
  return count;
}

/**
 * What a model may be shown to draft a reply (3.5.1): the topic, the order's
 * facts as they stand *now* — recomputed, because the automatic answer was
 * true when it was given and a parcel has moved since — and the turns, each
 * rendered to text. Never the shopper's name, email or the reference: the
 * facts are rendered without it. `supportDraft.ts` decides what of this
 * leaves, and withholds any turn carrying contact details.
 */
export async function draftMaterial(actor: Actor, id: number, now = new Date()): Promise<{ topic: SupportTopic; facts: string[]; turns: DraftTurn[] }> {
  assertCan(actor, "support.answer");
  const db = await handle();
  const [conversation] = await db.select().from(supportConversations).where(eq(supportConversations.id, id)).limit(1);
  if (!conversation) throw new SupportRefused("support.notFound");
  const { messages } = await thread(db, conversation, null);

  const english = (part: AnswerPart) => translate("en", part.key, { ...part.params, reference: "the order" });
  const current = conversation.orderReference ? await orderFacts(conversation.userId, conversation.orderReference, now) : null;
  const facts = current
    ? firstAnswer(conversation.topic, { order: current.facts, returnWindowDays: RETURN_WINDOW_DAYS })
        /* The facts, not the boilerplate around them. */
        .filter(part => part.key !== "support.answerPerson" && part.key !== "support.answerChooseOrder")
        .map(english)
    : [];

  return {
    topic: conversation.topic,
    facts,
    turns: messages.map(message => ({
      author: message.author,
      text: message.answer ? message.answer.filter(part => part.key !== "support.answerPerson").map(english).join(" ") : message.body ?? "",
    })),
  };
}
