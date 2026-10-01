/**
 * Reviews: the part that needs a database.
 *
 * The rules are `shared/commerce/reviews.ts` and are pure. What is here is the
 * reading and the writing, and one thing neither of those: **proving the
 * purchase by joining rather than by trusting the caller**.
 *
 * Every write starts from an order line the shopper owns, resolved by
 * `ctx.user.id` inside the query. A caller hands us an order-item id; if that
 * line belongs to somebody else the join returns nothing and the write is
 * refused as "not found" — the same argument the orders router makes about a
 * serial being short enough to guess. Nothing here takes a `productId` from
 * the caller and believes it: the product is read off the line.
 *
 * Outside `db.ts` for the reason `profile.ts`, `orders.ts`, `recommendations.ts`
 * and `wishlists.ts` are: functions inside `db.ts` call its module-local
 * `getDb`, which nothing outside can redirect, so they cannot be tested
 * against a real database.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { orderItems, orders, reviews } from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { contactFindings } from "../shared/commerce/contactFilter.js";
import {
  eligibilityFor,
  isValidRating,
  summarise,
  type ReviewRefusal,
  type ReviewSummary,
} from "../shared/commerce/reviews.js";

export type ReviewError = ReviewRefusal | "notFound" | "invalidRating" | "notYours" | "offPlatform";

export class ReviewRefused extends Error {
  constructor(readonly reason: ReviewError) {
    super(reason);
  }
}

async function db() {
  const database = await getDb();
  if (!database) throw new Error("reviews: no database configured");
  return database;
}

/* ---------------------------------------------------------- the shopper --- */

/**
 * The lines this shopper could review, and what stands in the way of each.
 *
 * Returns every delivered line rather than only the eligible ones, with the
 * refusal attached. A list that silently omits the thing somebody is looking
 * for teaches them the feature is broken; "you already reviewed this" is an
 * answer and an empty page is not.
 */
export async function reviewableLinesFor(userId: number) {
  const rows = await (await db())
    .select({
      orderItemId: orderItems.id,
      orderReference: orders.reference,
      orderStatus: orders.status,
      productId: orderItems.productId,
      productTitle: orderItems.productTitle,
      deliveredAt: orderItems.deliveredAt,
      reviewId: reviews.id,
      rating: reviews.rating,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(reviews, eq(reviews.orderItemId, orderItems.id))
    .where(eq(orders.userId, userId))
    .orderBy(desc(orderItems.deliveredAt), desc(orderItems.id));

  return rows.map(row => ({
    orderItemId: row.orderItemId,
    orderReference: row.orderReference,
    productId: row.productId === null ? null : String(row.productId),
    productTitle: row.productTitle,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    // The review's own id, so editing and deleting do not have to go looking
    // for it. Null when they have not written one.
    reviewId: row.reviewId,
    myRating: row.rating,
    eligibility: eligibilityFor({
      orderStatus: row.orderStatus,
      deliveredAt: row.deliveredAt,
      reviewed: row.reviewId !== null,
    }),
  }));
}

/**
 * Write a review against a line the shopper actually owns.
 *
 * The eligibility check runs on the row we read, not on anything the caller
 * sent — the same reason the return window is resolved server-side with the
 * server's clock. A page that offers a review the API would refuse is a bug;
 * a caller that fakes one is not possible, because the only thing it gets to
 * name is a line id and the join settles whether that line is theirs.
 */
export async function writeReview(
  userId: number,
  input: { orderItemId: number; rating: number; title?: string | null; body?: string | null },
): Promise<number> {
  if (!isValidRating(input.rating)) throw new ReviewRefused("invalidRating");

  const database = await db();
  const [line] = await database
    .select({
      id: orderItems.id,
      orderStatus: orders.status,
      deliveredAt: orderItems.deliveredAt,
      productId: orderItems.productId,
      vendorId: orderItems.vendorId,
      productTitle: orderItems.productTitle,
      reviewId: reviews.id,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(reviews, eq(reviews.orderItemId, orderItems.id))
    // The scope is in the where clause: somebody else's line is not found,
    // rather than found and then refused.
    .where(and(eq(orderItems.id, input.orderItemId), eq(orders.userId, userId)));

  if (!line) throw new ReviewRefused("notFound");

  const verdict = eligibilityFor({
    orderStatus: line.orderStatus,
    deliveredAt: line.deliveredAt,
    reviewed: line.reviewId !== null,
  });
  if (!verdict.allowed) throw new ReviewRefused(verdict.reason);

  const [row] = await database
    .insert(reviews)
    .values({
      orderItemId: line.id,
      userId,
      productId: line.productId,
      vendorId: line.vendorId,
      productTitle: line.productTitle,
      rating: input.rating,
      title: input.title?.trim() || null,
      body: input.body?.trim() || null,
    })
    .returning({ id: reviews.id });

  return row.id;
}

/**
 * Change a review you already wrote.
 *
 * Editing rather than deleting-and-rewriting, so the order line keeps exactly
 * one review and the unique index never has to be worked around. `userId` is
 * in the where clause for the usual reason.
 */
export async function editReview(
  userId: number,
  reviewId: number,
  patch: { rating?: number; title?: string | null; body?: string | null },
): Promise<void> {
  if (patch.rating !== undefined && !isValidRating(patch.rating)) throw new ReviewRefused("invalidRating");

  const changed = await (await db())
    .update(reviews)
    .set({
      ...(patch.rating === undefined ? {} : { rating: patch.rating }),
      ...(patch.title === undefined ? {} : { title: patch.title?.trim() || null }),
      ...(patch.body === undefined ? {} : { body: patch.body?.trim() || null }),
    })
    .where(and(eq(reviews.id, reviewId), eq(reviews.userId, userId)))
    .returning({ id: reviews.id });

  if (changed.length === 0) throw new ReviewRefused("notFound");
}

export async function deleteReview(userId: number, reviewId: number): Promise<void> {
  const gone = await (await db())
    .delete(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.userId, userId)))
    .returning({ id: reviews.id });
  if (gone.length === 0) throw new ReviewRefused("notFound");
}

/* ------------------------------------------------------------ the shelf --- */

export type PublicReview = {
  id: number;
  rating: number;
  title: string | null;
  body: string | null;
  /** A first name or an initial — never the full account name. See below. */
  author: string;
  createdAt: string;
  vendorReply: string | null;
  vendorRepliedAt: string | null;
  /** True for every row here, and said out loud rather than assumed. */
  verifiedPurchase: true;
};

/**
 * How a reviewer is named on a public page.
 *
 * First name and one initial, because a full legal name attached to a purchase
 * is more than anybody agreed to publish when they rated a kettle. Empty when
 * there is no name at all, and *never* an email — the page falls back to
 * "A NetLet shopper" rather than reaching for the one field that must not
 * appear here.
 *
 * **The initial comes from the second word, not the last one**, and that is a
 * Gulf-naming decision rather than a style choice. "Mona Al Sabah" has the
 * family name "Al Sabah", so the initial is A — taking the last word gives
 * "Mona S.", which is not her initial in any sense she would recognise. The
 * same rule reads correctly for a two-part name ("Yusuf Ahmed" → "Yusuf A.").
 * Found by a test written against a real Kuwaiti name rather than "John Smith".
 */
export function displayName(name: string | null): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0]}.`;
}

/**
 * Published reviews for one product, newest first.
 *
 * Hidden rows are excluded in the where clause rather than filtered after, for
 * the reason a private wishlist is: a query that fetches something and then
 * decides not to show it is one that eventually shows it.
 */
export async function reviewsForProduct(
  productId: number,
  options: { limit?: number; offset?: number } = {},
): Promise<{ items: PublicReview[]; summary: ReviewSummary | null; total: number }> {
  const database = await db();
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  // The summary is over every published review, not over the page — a rating
  // that changed when somebody pressed "next" would be nonsense.
  const all = await database
    .select({ rating: reviews.rating })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), isNull(reviews.hiddenAt)));

  const rows = await database
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      createdAt: reviews.createdAt,
      vendorReply: reviews.vendorReply,
      vendorRepliedAt: reviews.vendorRepliedAt,
      authorName: sql<string | null>`(select "name" from "users" where "users"."id" = ${reviews.userId})`,
    })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), isNull(reviews.hiddenAt)))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(limit)
    .offset(offset);

  return {
    total: all.length,
    summary: summarise(all.map(row => row.rating)),
    items: rows.map(row => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      author: displayName(row.authorName),
      createdAt: row.createdAt.toISOString(),
      vendorReply: row.vendorReply,
      vendorRepliedAt: row.vendorRepliedAt?.toISOString() ?? null,
      verifiedPurchase: true,
    })),
  };
}

/**
 * Rating summaries for many products at once.
 *
 * One grouped query rather than one per product: a category page draws twenty
 * cards, and twenty round trips to put a star on each is the N+1 that makes a
 * grid slow on exactly the connection this shop sells over.
 */
export async function summariesFor(productIds: number[]): Promise<Map<string, ReviewSummary>> {
  const out = new Map<string, ReviewSummary>();
  if (productIds.length === 0) return out;

  const rows = await (await db())
    .select({ productId: reviews.productId, rating: reviews.rating })
    .from(reviews)
    .where(and(sql`${reviews.productId} = any(${productIds})`, isNull(reviews.hiddenAt)));

  const byProduct = new Map<number, number[]>();
  for (const row of rows) {
    if (row.productId === null) continue;
    const list = byProduct.get(row.productId) ?? [];
    list.push(row.rating);
    byProduct.set(row.productId, list);
  }

  for (const [productId, ratings] of byProduct) {
    const summary = summarise(ratings);
    if (summary) out.set(String(productId), summary);
  }
  return out;
}

/* ------------------------------------------------------- vendor & admin --- */

/** A vendor's public answer to a review of their own product. */
export async function replyToReview(vendorId: number, reviewId: number, reply: string): Promise<void> {
  const text = reply.trim();
  /* A reply is public and the seller writes it, so it is the chat's leak with
     a bigger audience: "call us on 9988 7766 for a better price" under every
     review of the product. The same filter, for the same reason. */
  if (contactFindings(text).length > 0) throw new ReviewRefused("offPlatform");
  const changed = await (await db())
    .update(reviews)
    .set({ vendorReply: text || null, vendorRepliedAt: text ? new Date() : null })
    // Scoped to the vendor's own review, so a vendor cannot answer for another.
    .where(and(eq(reviews.id, reviewId), eq(reviews.vendorId, vendorId)))
    .returning({ id: reviews.id });
  if (changed.length === 0) throw new ReviewRefused("notYours");
}

/**
 * Take a review off the page, keeping the row.
 *
 * Hiding rather than deleting: a removed review is a fact about moderation and
 * the record should keep it, along with the reason somebody gave. Deleting
 * would also delete the evidence of why.
 */
export async function setReviewHidden(reviewId: number, hidden: boolean, reason?: string): Promise<void> {
  const changed = await (await db())
    .update(reviews)
    .set({
      hiddenAt: hidden ? new Date() : null,
      hiddenReason: hidden ? (reason?.trim() || null) : null,
    })
    .where(eq(reviews.id, reviewId))
    .returning({ id: reviews.id });
  if (changed.length === 0) throw new ReviewRefused("notFound");
}

/**
 * Mark an order line as delivered, which is what opens the review window.
 *
 * The date is set once and never moved by a later edit: `deliveredAt` is when
 * the goods arrived, and a vendor correcting a typo on the line must not push
 * somebody's return window or review right out of reach.
 */
export async function markLineDelivered(orderItemId: number, when: Date = new Date()): Promise<void> {
  await (await db())
    .update(orderItems)
    .set({ fulfilment: "delivered", deliveredAt: when })
    .where(and(eq(orderItems.id, orderItemId), isNull(orderItems.deliveredAt)));
}
