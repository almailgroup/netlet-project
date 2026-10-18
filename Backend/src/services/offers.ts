/**
 * The special-price negotiation's database half.
 *
 * `Shared/commerce/priceOffers.ts` is the rule set and is pure. This is the
 * part that cannot be — reading the shelf price one last time before a request
 * is recorded, refusing a second open request race-safely, and resolving what
 * a signed-in shopper actually pays.
 *
 * Outside `db.ts` for the reason `orders.ts`, `profile.ts` and `finance.ts`
 * are: functions inside it reach its module-local `getDb`, which nothing
 * outside can redirect, so anything living there cannot be tested against a
 * real database.
 *
 * **Guards live next to the query, not in the router alone.** A second caller
 * added later would skip a router-level check silently — the same argument
 * `Backend/src/services/inventory.ts` makes, and the same `assertCan` throwing
 * `FORBIDDEN:<capability>` for the router to turn into a 403.
 */
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { priceOffers, products, productVariants, vendors } from "../../database/schema.js";
import {
  acceptableAsk,
  acceptableOffer,
  askExpiry,
  MAX_NOTE,
  negotiable,
  offerExpiry,
  resolveOffer,
  type OfferRow,
  type OfferState,
} from "../../../Shared/commerce/priceOffers.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../../../Shared/pagination.js";
import { violatesUnique } from "../core/describeError.js";
import { getDb } from "./db.js";
import { tellOfferAnswered } from "./notifications.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** What the storefront and the inbox both render. */
export type OfferView = {
  id: number;
  state: OfferState;
  variantId: number;
  productId: number | null;
  productHandle: string | null;
  productTitle: string;
  variantTitle: string | null;
  vendorId: number | null;
  vendorName: string | null;
  listPrice: string;
  askedPrice: string;
  offeredPrice: string | null;
  quantity: number;
  shopperNote: string | null;
  vendorNote: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  /** Only ever filled for the vendor's own inbox. */
  shopperName: string | null;
};

/* Every failure is a string the router translates, never a sentence. A message
   assembled here would be an English one shown on an Arabic page. */
export const OFFER_REFUSALS = [
  "NOT_NEGOTIABLE",
  "UNAVAILABLE",
  "ASK_OUT_OF_RANGE",
  "OFFER_OUT_OF_RANGE",
  "ALREADY_OPEN",
  "NOT_OPEN",
] as const;
export type OfferRefusal = (typeof OFFER_REFUSALS)[number];

export class OfferError extends Error {
  constructor(readonly refusal: OfferRefusal) {
    super(refusal);
  }
}


const trimNote = (note: string | null | undefined) => {
  const text = note?.trim();
  return text ? text.slice(0, MAX_NOTE) : null;
};

function viewOf(row: {
  offer: typeof priceOffers.$inferSelect;
  productHandle: string | null;
  variantTitle: string | null;
  vendorName: string | null;
  shopperName?: string | null;
}, now: Date): OfferView {
  const offer = row.offer;
  return {
    id: offer.id,
    state: resolveOffer(offer as OfferRow, now),
    variantId: offer.variantId,
    productId: offer.productId,
    productHandle: row.productHandle,
    productTitle: offer.productTitle,
    variantTitle: row.variantTitle,
    vendorId: offer.vendorId,
    vendorName: row.vendorName,
    listPrice: offer.listPrice,
    askedPrice: offer.askedPrice,
    offeredPrice: offer.offeredPrice,
    quantity: offer.quantity,
    shopperNote: offer.shopperNote,
    vendorNote: offer.vendorNote,
    expiresAt: offer.expiresAt,
    createdAt: offer.createdAt,
    shopperName: row.shopperName ?? null,
  };
}

/**
 * The shelf, as it stands, for one variant.
 *
 * Read under the same conditions the storefront sells under — published
 * product, approved vendor — because a request for a discount on something
 * nobody can buy is not a request anybody should have to answer.
 */
async function sellableVariant(db: Db, variantId: number) {
  const [row] = await db
    .select({
      variantId: productVariants.id,
      variantTitle: productVariants.title,
      price: productVariants.price,
      productId: products.id,
      productTitle: products.title,
      productAcceptsOffers: products.acceptsOffers,
      vendorId: vendors.id,
      vendorName: vendors.name,
      vendorAcceptsOffers: vendors.acceptsOffers,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(eq(productVariants.id, variantId), eq(products.status, "published"), eq(vendors.status, "approved")))
    .limit(1);
  return row ?? null;
}

/** Whether this variant may be haggled over at all, for the product page. */
export async function offersOpenOn(variantIds: number[]): Promise<Set<number>> {
  const db = await getDb();
  if (!db || !variantIds.length) return new Set();

  const rows = await db
    .select({
      variantId: productVariants.id,
      productAcceptsOffers: products.acceptsOffers,
      vendorAcceptsOffers: vendors.acceptsOffers,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(inArray(productVariants.id, variantIds), eq(products.status, "published"), eq(vendors.status, "approved")));

  return new Set(
    rows.filter(row => negotiable(row.vendorAcceptsOffers, row.productAcceptsOffers)).map(row => row.variantId),
  );
}

/**
 * Ask a seller for a price.
 *
 * The shelf price is read here rather than trusted from the client, and frozen
 * onto the row: the seller is answering a question about a number, and if the
 * catalog moves underneath them the inbox would quietly rewrite what they were
 * asked. It is the same reason the order freezes every figure it holds.
 */
export async function requestOffer(input: {
  userId: number;
  variantId: number;
  askedPrice: string;
  quantity: number;
  note?: string | null;
}): Promise<OfferView> {
  const db = await getDb();
  if (!db) throw new OfferError("UNAVAILABLE");

  const variant = await sellableVariant(db, input.variantId);
  if (!variant) throw new OfferError("UNAVAILABLE");
  if (!negotiable(variant.vendorAcceptsOffers, variant.productAcceptsOffers)) {
    throw new OfferError("NOT_NEGOTIABLE");
  }
  if (!acceptableAsk(variant.price, input.askedPrice)) throw new OfferError("ASK_OUT_OF_RANGE");

  const now = new Date();
  let inserted;
  try {
    [inserted] = await db
      .insert(priceOffers)
      .values({
        userId: input.userId,
        variantId: variant.variantId,
        productId: variant.productId,
        vendorId: variant.vendorId,
        productTitle: variant.productTitle,
        listPrice: variant.price,
        askedPrice: input.askedPrice,
        quantity: Math.max(1, Math.trunc(input.quantity)),
        shopperNote: trimNote(input.note),
        status: "pending",
        expiresAt: askExpiry(now),
      })
      .returning();
  } catch (error) {
    /*
     * The partial unique index is what actually stops a second open request,
     * because two tabs are enough to beat a read-then-insert check. Catching
     * its violation is the honest way to report the collision: asking first
     * and inserting second would still let both through.
     */
    if (violatesUnique(error, "price_offers_open_unique")) throw new OfferError("ALREADY_OPEN");
    throw error;
  }

  return viewOf(
    { offer: inserted, productHandle: null, variantTitle: variant.variantTitle, vendorName: variant.vendorName },
    now,
  );
}

/** Everything one shopper has asked for, newest first. */
export async function listOffersForShopper(userId: number): Promise<OfferView[]> {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();

  const rows = await db
    .select({
      offer: priceOffers,
      productHandle: products.handle,
      variantTitle: productVariants.title,
      vendorName: vendors.name,
    })
    .from(priceOffers)
    .leftJoin(products, eq(priceOffers.productId, products.id))
    .leftJoin(productVariants, eq(priceOffers.variantId, productVariants.id))
    .leftJoin(vendors, eq(priceOffers.vendorId, vendors.id))
    .where(eq(priceOffers.userId, userId))
    .orderBy(desc(priceOffers.createdAt), desc(priceOffers.id))
    .limit(100);

  return rows.map(row => viewOf(row, now));
}

/** What this shopper has going on one variant, for the product page. */
export async function offerForVariant(userId: number, variantId: number): Promise<OfferView | null> {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();

  const [row] = await db
    .select({
      offer: priceOffers,
      productHandle: products.handle,
      variantTitle: productVariants.title,
      vendorName: vendors.name,
    })
    .from(priceOffers)
    .leftJoin(products, eq(priceOffers.productId, products.id))
    .leftJoin(productVariants, eq(priceOffers.variantId, productVariants.id))
    .leftJoin(vendors, eq(priceOffers.vendorId, vendors.id))
    .where(and(eq(priceOffers.userId, userId), eq(priceOffers.variantId, variantId)))
    .orderBy(desc(priceOffers.createdAt), desc(priceOffers.id))
    .limit(1);

  return row ? viewOf(row, now) : null;
}

/**
 * The live agreed prices for a shopper, keyed by variant.
 *
 * This is what the cart and the order consult, and it takes a `db` rather than
 * fetching its own so the order can call it inside the transaction that is
 * already open. Only rows that are both answered and unspent come back; the
 * pure `priceFor` still decides what is actually charged, because the shelf
 * may since have fallen below what was agreed.
 */
export async function liveOffersFor(
  db: Db,
  userId: number | null | undefined,
  variantIds: number[],
  now: Date = new Date(),
): Promise<Map<number, OfferRow & { id: number }>> {
  const live = new Map<number, OfferRow & { id: number }>();
  if (!userId || !variantIds.length) return live;

  const rows = await db
    .select({
      id: priceOffers.id,
      variantId: priceOffers.variantId,
      status: priceOffers.status,
      offeredPrice: priceOffers.offeredPrice,
      expiresAt: priceOffers.expiresAt,
      usedOnOrderId: priceOffers.usedOnOrderId,
    })
    .from(priceOffers)
    .where(
      and(
        eq(priceOffers.userId, userId),
        inArray(priceOffers.variantId, variantIds),
        eq(priceOffers.status, "offered"),
        isNull(priceOffers.usedOnOrderId),
      ),
    );

  for (const row of rows) {
    const offer = { ...row, status: row.status as OfferRow["status"] };
    if (resolveOffer(offer, now) !== "offered" || row.offeredPrice === null) continue;
    /* Newest wins if a shopper somehow holds two on one variant — the unique
       index makes that impossible today, and relying on impossibility is how
       a Map ends up non-deterministic later. */
    const held = live.get(row.variantId);
    if (!held || held.id < row.id) live.set(row.variantId, offer);
  }
  return live;
}

/**
 * Spend the agreed prices on an order.
 *
 * Takes the transaction's `db`, so marking them used cannot commit separately
 * from the order that used them — a grant spent against an order that then
 * rolled back would be a discount the shopper lost for nothing.
 */
export async function markOffersUsed(db: Db, offerIds: number[], orderId: number): Promise<void> {
  if (!offerIds.length) return;
  await db
    .update(priceOffers)
    .set({ usedOnOrderId: orderId })
    .where(and(inArray(priceOffers.id, offerIds), isNull(priceOffers.usedOnOrderId)));
}

/** A shopper taking their own request back. */
export async function withdrawOffer(userId: number, offerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new OfferError("UNAVAILABLE");

  const updated = await db
    .update(priceOffers)
    .set({ status: "withdrawn" })
    /* Scoped by `userId` inside the query rather than filtered afterwards: an
       id is a serial, so "withdraw request 4" has to be refused by the write
       itself. The same rule the order reads follow. */
    .where(
      and(
        eq(priceOffers.id, offerId),
        eq(priceOffers.userId, userId),
        isNull(priceOffers.usedOnOrderId),
        or(eq(priceOffers.status, "pending"), eq(priceOffers.status, "offered")),
      ),
    )
    .returning({ id: priceOffers.id });

  if (!updated.length) throw new OfferError("NOT_OPEN");
}

/* ----------------------------------------------------------- the inbox --- */

/**
 * The requests waiting on a seller.
 *
 * Scoped in the query by the vendor the actor belongs to, never filtered in
 * the router: an admin sees every seller's, a vendor member sees their own
 * company's and nothing else.
 */
export async function listOffersForVendor(
  actor: Actor,
  request: { page?: number; pageSize?: number; open?: boolean } = {},
): Promise<Page<OfferView>> {
  assertCan(actor, "offer.answer", actor.kind === "vendor" ? actor.vendorId : undefined);

  const pageSize = clampPageSize(request.pageSize);
  const db = await getDb();
  if (!db) return { rows: [], total: 0, page: 1, pageSize };

  const scope = and(
    actor.kind === "vendor" ? eq(priceOffers.vendorId, actor.vendorId) : undefined,
    /*
     * "Open" is pending *and* unexpired, worked out in SQL rather than by
     * fetching everything and filtering — the same reason the product search
     * moved to the server: a filter applied to the page you happen to be on
     * reports "nothing waiting" for a request on page two.
     */
    request.open
      ? and(
          eq(priceOffers.status, "pending"),
          isNull(priceOffers.usedOnOrderId),
          sql`(${priceOffers.expiresAt} is null or ${priceOffers.expiresAt} > now())`,
        )
      : undefined,
  );

  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(priceOffers).where(scope);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);

  const rows = await db
    .select({
      offer: priceOffers,
      productHandle: products.handle,
      variantTitle: productVariants.title,
      vendorName: vendors.name,
      shopperName: sql<string | null>`null`,
    })
    .from(priceOffers)
    .leftJoin(products, eq(priceOffers.productId, products.id))
    .leftJoin(productVariants, eq(priceOffers.variantId, productVariants.id))
    .leftJoin(vendors, eq(priceOffers.vendorId, vendors.id))
    .where(scope)
    /* Ends on the id, which is unique. `createdAt` alone ties on a bulk insert
       and Postgres orders ties freely between two queries, so offset paging
       over it repeats rows on one page and skips them on the next. */
    .orderBy(desc(priceOffers.createdAt), desc(priceOffers.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));

  const now = new Date();
  return { rows: rows.map(row => viewOf(row, now)), total, page, pageSize };
}

/** The row, with the actor's scope checked against the vendor that owns it. */
async function answerable(db: Db, actor: Actor, offerId: number) {
  const [row] = await db.select().from(priceOffers).where(eq(priceOffers.id, offerId)).limit(1);
  if (!row) throw new OfferError("NOT_OPEN");
  // Checked against the request's own vendor, so asking with somebody else's
  // id is a refusal rather than a leak.
  assertCan(actor, "offer.answer", row.vendorId ?? undefined);
  if (row.usedOnOrderId !== null || row.status !== "pending") throw new OfferError("NOT_OPEN");
  return row;
}

/**
 * The seller's price.
 *
 * Checked against the price frozen on the request, not today's shelf: the
 * seller is answering the question they were asked. If the shelf has since
 * fallen below the answer, `priceFor` hands the shopper the lower figure — the
 * agreed price is a ceiling, and that rule lives in one place.
 */
export async function answerOffer(
  actor: Actor,
  input: { offerId: number; offeredPrice: string; note?: string | null; actorUserId?: number | null },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new OfferError("UNAVAILABLE");

  const row = await answerable(db, actor, input.offerId);
  if (!acceptableOffer(row.listPrice, input.offeredPrice)) throw new OfferError("OFFER_OUT_OF_RANGE");

  const now = new Date();
  const written = await db
    .update(priceOffers)
    .set({
      status: "offered",
      offeredPrice: input.offeredPrice,
      vendorNote: trimNote(input.note),
      answeredAt: now,
      answeredBy: input.actorUserId ?? null,
      /* The window restarts from the answer: the seller had a week to reply,
         and the shopper now has their own, shorter one to use it. */
      expiresAt: offerExpiry(now),
    })
    .where(stillOpen(row.id, now))
    .returning({ id: priceOffers.id });
  if (written.length === 0) throw new OfferError("NOT_OPEN");
  await tellOfferAnswered(row.id, "offered");
}

/** A refusal, with a reason if the seller gave one. */
export async function declineOffer(
  actor: Actor,
  input: { offerId: number; note?: string | null; actorUserId?: number | null },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new OfferError("UNAVAILABLE");

  const row = await answerable(db, actor, input.offerId);
  const now = new Date();
  const written = await db
    .update(priceOffers)
    .set({
      status: "declined",
      vendorNote: trimNote(input.note),
      answeredAt: now,
      answeredBy: input.actorUserId ?? null,
    })
    .where(stillOpen(row.id, now))
    .returning({ id: priceOffers.id });
  if (written.length === 0) throw new OfferError("NOT_OPEN");
  await tellOfferAnswered(row.id, "declined");
}

/**
 * The request is still the seller's to answer: pending, unused, inside its
 * window — asked in the write itself. Checked only on the read before, so a
 * shopper withdrawing a request while the seller typed a price had it come
 * back to life as an offer, and a request past its window could still be
 * answered from the API though the page no longer offered the form.
 */
function stillOpen(offerId: number, now: Date) {
  return and(
    eq(priceOffers.id, offerId),
    eq(priceOffers.status, "pending"),
    isNull(priceOffers.usedOnOrderId),
    or(isNull(priceOffers.expiresAt), gt(priceOffers.expiresAt, now)),
  );
}

/** How many are waiting on this seller — the number the portal's overview shows. */
export async function countOpenOffers(actor: Actor): Promise<number> {
  assertCan(actor, "offer.answer", actor.kind === "vendor" ? actor.vendorId : undefined);
  const db = await getDb();
  if (!db) return 0;

  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(priceOffers)
    .where(
      and(
        actor.kind === "vendor" ? eq(priceOffers.vendorId, actor.vendorId) : undefined,
        eq(priceOffers.status, "pending"),
        isNull(priceOffers.usedOnOrderId),
        sql`(${priceOffers.expiresAt} is null or ${priceOffers.expiresAt} > now())`,
      ),
    );
  return counted?.n ?? 0;
}

/* ------------------------------------------------------------- opting in --- */

/**
 * Whether this store answers price requests at all.
 *
 * `vendor.editProfile`, so a vendor **owner** can turn it on for their own
 * shop rather than asking an administrator. What it switches on is their own
 * inbox, which makes it theirs to decide — unlike commission, which sits
 * outside a vendor's control entirely because it is NetLet's side of the deal.
 */
export async function setVendorAcceptsOffers(actor: Actor, vendorId: number, accepts: boolean): Promise<void> {
  assertCan(actor, "vendor.editProfile", vendorId);
  const db = await getDb();
  if (!db) throw new OfferError("UNAVAILABLE");
  await db.update(vendors).set({ acceptsOffers: accepts }).where(eq(vendors.id, vendorId));
}

/** Read it back, so the inbox can draw the switch in the right position. */
export async function vendorAcceptsOffers(actor: Actor, vendorId?: number): Promise<boolean | null> {
  const id = vendorId ?? (actor.kind === "vendor" ? actor.vendorId : undefined);
  if (id === undefined) return null;
  assertCan(actor, "offer.answer", id);
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select({ accepts: vendors.acceptsOffers }).from(vendors).where(eq(vendors.id, id)).limit(1);
  return row?.accepts ?? null;
}

/**
 * This product's own answer, overriding its vendor's.
 *
 * `null` clears the override rather than setting "no": the three states are
 * "yes", "no" and "ask the vendor", and a boolean column would have lost the
 * third — the same shape, and the same argument, as the per-product commission
 * rate. `product.edit`, because it is a fact about the listing.
 */
export async function setProductAcceptsOffers(
  actor: Actor,
  productId: number,
  accepts: boolean | null,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new OfferError("UNAVAILABLE");
  const [row] = await db.select({ vendorId: products.vendorId }).from(products).where(eq(products.id, productId)).limit(1);
  if (!row) throw new OfferError("UNAVAILABLE");
  // Checked against the product's own vendor, so somebody else's id is a
  // refusal rather than a write.
  assertCan(actor, "product.edit", row.vendorId);
  await db.update(products).set({ acceptsOffers: accepts }).where(eq(products.id, productId));
}
