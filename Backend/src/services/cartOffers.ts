/**
 * A store's products in shoppers' carts, and a price it sends to one.
 *
 * On the owner's word: a store is told when its product goes in a cart
 * (`tellCartAdd`, once per cart and product), and may send that cart a
 * special price. The price is an ordinary agreed price — a `price_offers`
 * row, born `offered`, `started_by` the store (migration 0094) — so the bag
 * and the order apply it by the rule they already have (`liveOffersFor`,
 * `priceFor`: a ceiling, never a floor) and the shopper sees it as "Your price
 * from the store". It needs no discount permit, being quoted to one shopper
 * rather than advertised, and it never sets a struck-through price.
 *
 * **The store never learns who.** Nothing here selects a name, an email, an
 * address or an account id into what the store reads; a line is named by the
 * cart line's own id, which the store can only use to send a price to the
 * cart that holds its product, and every query asks that the line's product
 * is the store's. Only a signed-in shopper's cart, since a price is a price
 * for an account, and never a store's own people.
 *
 * **Closed, not broken, until 0094 is pasted**: the list answers `ready:
 * false`, and sending refuses with `CLOSED`.
 */
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { cartItems, carts, priceOffers, productImages, productVariants, products, vendorMembers, vendors } from "../../database/schema.js";
import {
  acceptableStorePrice,
  cartInterestSince,
  cartLineAction,
  MAX_NOTE,
  offerExpiry,
  resolveOffer,
  type CartLineAction,
  type OfferRow,
  type OfferState,
} from "../../../Shared/commerce/priceOffers.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../../../Shared/pagination.js";
import { violatesUnique } from "../core/describeError.js";
import { getDb } from "./db.js";
import { tellStoreOffered } from "./notifications.js";
import { offerFields, offerStartsReady, starterOf, type OfferStarter } from "./offerStarts.js";
import { OfferError, retireLapsed } from "./offers.js";

/** One of the store's products in one shopper's cart, as the store sees it. */
export type CartInterest = {
  /** The cart line, which is all a store needs to send that cart a price. */
  lineId: number;
  productId: number;
  productHandle: string;
  productTitle: string;
  productTitleAr: string | null;
  variantTitle: string;
  image: string | null;
  quantity: number;
  /** What the shelf asks today. */
  listPrice: string;
  addedAt: Date;
  /** The newest price on that shopper and variant, whoever began it. */
  offer: { state: OfferState; price: string | null; expiresAt: Date | null; startedBy: OfferStarter } | null;
  action: CartLineAction;
};

/** Whether 0094 is pasted, beside the page. */
export type CartInterestPage = Page<CartInterest> & { ready: boolean };

/*
 * The lines a store may see: its own product (or, for NetLet, any store's —
 * `vendorId` narrows it), on the shop, in a signed-in shopper's cart, added
 * inside the window, and not in a cart of one of that store's own people.
 */
function interestScope(vendorId: number | undefined, since: Date) {
  return and(
    vendorId !== undefined ? eq(products.vendorId, vendorId) : undefined,
    eq(products.status, "published"),
    eq(vendors.status, "approved"),
    isNotNull(carts.userId),
    gte(cartItems.createdAt, since),
    sql`not exists (select 1 from ${vendorMembers} where ${vendorMembers.userId} = ${carts.userId} and ${vendorMembers.vendorId} = ${products.vendorId})`,
  );
}

/** The store's products in shoppers' carts, newest first. */
export async function listCartInterest(
  actor: Actor,
  request: { page?: number; pageSize?: number } = {},
  now: Date = new Date(),
): Promise<CartInterestPage> {
  const vendorId = actor.kind === "vendor" ? actor.vendorId : undefined;
  assertCan(actor, "offer.answer", vendorId);
  const pageSize = clampPageSize(request.pageSize);
  const db = await getDb();
  if (!db) return { rows: [], total: 0, page: 1, pageSize, ready: false };
  const ready = await offerStartsReady(db);

  const scope = interestScope(vendorId, cartInterestSince(now));
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(scope);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);

  const lines = await db
    .select({
      lineId: cartItems.id,
      /* The cart's owner and the variant, to find the price on that pair —
         read here and never handed to the store. */
      userId: carts.userId,
      variantId: cartItems.variantId,
      productId: products.id,
      productHandle: products.handle,
      productTitle: products.title,
      productTitleAr: products.titleAr,
      variantTitle: productVariants.title,
      quantity: cartItems.quantity,
      listPrice: productVariants.price,
      addedAt: cartItems.createdAt,
    })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(scope)
    .orderBy(desc(cartItems.createdAt), desc(cartItems.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));

  const productIds = [...new Set(lines.map(line => line.productId))];
  const images = productIds.length
    ? await db
        .select({ productId: productImages.productId, url: productImages.url })
        .from(productImages)
        .where(and(inArray(productImages.productId, productIds), eq(productImages.kind, "image")))
        .orderBy(productImages.position, productImages.id)
    : [];
  const imageOf = new Map<number, string>();
  for (const image of images) if (!imageOf.has(image.productId)) imageOf.set(image.productId, image.url);

  /* The newest price on each shopper and variant on the page. */
  const userIds = [...new Set(lines.map(line => line.userId).filter((id): id is number => id !== null))];
  const variantIds = [...new Set(lines.map(line => line.variantId))];
  const offers = userIds.length
    ? await db
        .select({ ...offerFields(ready) })
        .from(priceOffers)
        .where(and(inArray(priceOffers.userId, userIds), inArray(priceOffers.variantId, variantIds)))
        .orderBy(desc(priceOffers.id))
    : [];
  const newest = new Map<string, (typeof offers)[number]>();
  for (const offer of offers) {
    const key = `${offer.userId}:${offer.variantId}`;
    if (!newest.has(key)) newest.set(key, offer);
  }

  const rows: CartInterest[] = lines.map(line => {
    const offer = newest.get(`${line.userId}:${line.variantId}`) ?? null;
    const asRow: OfferRow | null = offer
      ? { status: offer.status as OfferRow["status"], offeredPrice: offer.offeredPrice, expiresAt: offer.expiresAt, usedOnOrderId: offer.usedOnOrderId }
      : null;
    return {
      lineId: line.lineId,
      productId: line.productId,
      productHandle: line.productHandle,
      productTitle: line.productTitle,
      productTitleAr: line.productTitleAr,
      variantTitle: line.variantTitle,
      image: imageOf.get(line.productId) ?? null,
      quantity: line.quantity,
      listPrice: line.listPrice,
      addedAt: line.addedAt,
      offer: offer && asRow
        ? { state: resolveOffer(asRow, now), price: offer.offeredPrice, expiresAt: offer.expiresAt, startedBy: starterOf(offer.startedBy) }
        : null,
      action: cartLineAction(asRow, now),
    };
  });

  return { rows, total, page, pageSize, ready };
}

const trimNote = (note: string | null | undefined) => {
  const text = note?.trim();
  return text ? text.slice(0, MAX_NOTE) : null;
};

/**
 * Send a price to a cart one of the store's products is in.
 *
 * Asked again here, of the line as it stands: still in a signed-in shopper's
 * cart, inside the window, the store's own product, on the shop, not a cart
 * of the store's own people. The price is below today's shelf and above
 * nothing. A shopper waiting on their own request is answered there, not
 * sent a second price (`ASKED_OPEN`); a shopper already holding one keeps it
 * (`ALREADY_OPEN`) — the open-price index decides, so two presses cannot both
 * land.
 */
export async function sendCartOffer(
  actor: Actor,
  input: { lineId: number; price: string; note?: string | null; actorUserId?: number | null },
  now: Date = new Date(),
): Promise<{ offerId: number; expiresAt: Date }> {
  const db = await getDb();
  if (!db) throw new OfferError("UNAVAILABLE");

  const [line] = await db
    .select({
      userId: carts.userId,
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      addedAt: cartItems.createdAt,
      listPrice: productVariants.price,
      productId: products.id,
      productTitle: products.title,
      vendorId: products.vendorId,
    })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(and(eq(cartItems.id, input.lineId), interestScope(undefined, cartInterestSince(now))))
    .limit(1);
  if (!line?.userId) throw new OfferError("LINE_GONE");
  /* Checked against the product's own store, so another store's line is a
     refusal rather than a price sent in somebody else's name. */
  assertCan(actor, "offer.answer", line.vendorId);
  if (!(await offerStartsReady(db))) throw new OfferError("CLOSED");
  if (!acceptableStorePrice(line.listPrice, input.price)) throw new OfferError("STORE_PRICE_OUT_OF_RANGE");

  await retireLapsed(db, line.userId, line.variantId, now);
  const expiresAt = offerExpiry(now);
  let offerId: number;
  try {
    const [row] = await db
      .insert(priceOffers)
      .values({
        userId: line.userId,
        variantId: line.variantId,
        productId: line.productId,
        vendorId: line.vendorId,
        productTitle: line.productTitle,
        listPrice: line.listPrice,
        /* Nobody asked: what was "asked" is the price the store sent, so
           every reader of the row has a figure that means something. */
        askedPrice: input.price,
        quantity: line.quantity,
        vendorNote: trimNote(input.note),
        status: "offered",
        offeredPrice: input.price,
        expiresAt,
        answeredAt: now,
        answeredBy: input.actorUserId ?? null,
        startedBy: "store",
      })
      .returning({ id: priceOffers.id });
    if (!row) throw new OfferError("UNAVAILABLE");
    offerId = row.id;
  } catch (error) {
    if (!violatesUnique(error, "price_offers_open_unique")) throw error;
    const [open] = await db
      .select({ status: priceOffers.status })
      .from(priceOffers)
      .where(and(eq(priceOffers.userId, line.userId), eq(priceOffers.variantId, line.variantId), inArray(priceOffers.status, ["pending", "offered"])))
      .limit(1);
    throw new OfferError(open?.status === "pending" ? "ASKED_OPEN" : "ALREADY_OPEN");
  }

  await tellStoreOffered(offerId);
  return { offerId, expiresAt };
}

/** How many of the store's products sit in shoppers' carts inside the window — the overview's figure. */
export async function countCartInterest(actor: Actor, now: Date = new Date()): Promise<number> {
  const vendorId = actor.kind === "vendor" ? actor.vendorId : undefined;
  assertCan(actor, "offer.answer", vendorId);
  const db = await getDb();
  if (!db) return 0;
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(interestScope(vendorId, cartInterestSince(now)));
  return counted?.n ?? 0;
}
