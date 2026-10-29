/**
 * The storefront's read side, and the cart.
 *
 * This replaces the Shopify adapter. Everything a shopper sees comes from
 * NetLet's own tables now: `publishedCatalog` decides what is visible,
 * `fromInventory` decides what shape it arrives in, and this file is the
 * join between them plus the bag.
 *
 * Two rules hold throughout:
 *
 * - A shopper only ever sees a published product of an approved vendor. That
 *   is enforced in `Backend/src/services/inventory.ts`, not repeated here, so suspension
 *   stays a single lever rather than a rule copied into two files.
 * - Cart prices are read at read time, never stored. See `cartItems` in the
 *   schema for why.
 */

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  cartItemAddons,
  cartItems,
  carts,
  categories,
  orderItems,
  orders,
  productAddons,
  productImages,
  products,
  productVariants,
  reviews,
  vendors,
} from "../../database/schema.js";
import {
  CURRENCY,
  pick,
  toStorefrontCollection,
  toStorefrontProduct,
  type LocalePick,
} from "../../../Shared/commerce/fromInventory.js";
import { MAX_LINE_QUANTITY, type Cart, type CartItem, type Collection, type Product } from "../../../Shared/commerce/types.js";
import type { Measure } from "../../../Shared/commerce/units.js";
import { publishedCatalog, publishedProduct } from "./inventory.js";
import { getDb } from "./db.js";
import { addMoney, compareMoney, multiplyMoney } from "../../../Shared/money.js";
import { addonsTotal, type AddonKind } from "../../../Shared/commerce/addons.js";
import { bundlePricing } from "./bundles.js";
import { effectiveChoice, groupForDelivery, offersFast, quoteDelivery, type DeliveryRule } from "../../../Shared/commerce/delivery.js";
import type { DestinedLine } from "../../../Shared/commerce/addresses.js";
import { listAddresses } from "./addresses.js";
import { codAvailability } from "../../../Shared/commerce/payment.js";
import { recoveryFor } from "../../../Shared/commerce/cartRecovery.js";
import { liveOffersFor } from "./offers.js";
import { freeDeliveryOver, isMemberNow } from "./membership.js";
import { shopperPrice } from "../../../Shared/commerce/shopperPrice.js";
import { memberPriceFor, waiveDelivery } from "../../../Shared/commerce/membership.js";
import { discountAllowed } from "../../../Shared/inventory/discountLicence.js";
import { isDeliverySpeed, speedForLine, type DeliverySpeed } from "../../../Shared/commerce/deliverySpeed.js";
import { recentReviewsForStore, type StoreReview } from "./reviews.js";
import { featureOn } from "./features.js";
import {
  awardedBadges,
  FAST_SHIPPING_HOURS,
  FAST_SHIPPING_WINDOW_DAYS,
  HIGH_RATING_MIN_REVIEWS,
  storefrontBadges,
  type TrustBadge,
} from "../../../Shared/inventory/vendorHealth.js";

/* ------------------------------------------------------------- the shelf --- */

type Named = { id: number; name: string; nameAr: string | null };
/** A vendor also carries its badges — awarded on the row, then measured by `badgesFor`. */
type VendorNamed = Named & {
  /** The store's public address, `/stores/<slug>`. */
  slug: string;
  badges: string[] | null;
  discountLicenceNumber: string | null;
  discountLicenceExpiresAt: Date | null;
  /* The store's usual shipping band, which a product may override (3.2.5). */
  deliverySpeed: string | null;
  deliveryProvider: string | null;
  subscriptionPercent: string | null;
};

/**
 * Vendor and category names for a set of products, in two queries rather than
 * two per product.
 */
async function contextFor(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  rows: { vendorId: number; categoryId: number | null }[],
) {
  const vendorIds = [...new Set(rows.map(row => row.vendorId))];
  const categoryIds = [...new Set(rows.map(row => row.categoryId).filter((id): id is number => id !== null))];

  const [vendorRows, categoryRows] = await Promise.all([
    vendorIds.length
      ? db.select({ id: vendors.id, slug: vendors.slug, name: vendors.name, nameAr: vendors.nameAr, badges: vendors.badges, discountLicenceNumber: vendors.discountLicenceNumber, discountLicenceExpiresAt: vendors.discountLicenceExpiresAt, deliverySpeed: vendors.deliverySpeed, deliveryProvider: vendors.deliveryProvider, subscriptionPercent: vendors.subscriptionPercent }).from(vendors).where(inArray(vendors.id, vendorIds))
      : Promise.resolve([] as VendorNamed[]),
    categoryIds.length
      ? db.select({ id: categories.id, name: categories.name, nameAr: categories.nameAr }).from(categories).where(inArray(categories.id, categoryIds))
      : Promise.resolve([] as Named[]),
  ]);

  const badgesById = await badgesFor(db, vendorRows);
  const vendorById = new Map(vendorRows.map(row => [row.id, { ...row, badges: badgesById.get(row.id) ?? [] }]));
  const categoryById = new Map(categoryRows.map(row => [row.id, row]));
  return { vendorById, categoryById };
}

/**
 * The badges each store's own numbers support, measured on the read.
 *
 * Two grouped queries for the whole set rather than two per product. Earned
 * badges are never stored, so a store whose reviews slip or whose parcels
 * start arriving late stops showing them without anybody pressing anything —
 * the rule the discount permit follows for the strikethrough.
 */
export async function badgesFor(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  vendorRows: { id: number; badges: string[] | null }[],
): Promise<Map<number, TrustBadge[]>> {
  const vendorIds = vendorRows.map(row => row.id);
  if (!vendorIds.length) return new Map();
  const since = new Date(Date.now() - FAST_SHIPPING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [ratings, deliveries] = await Promise.all([
    db
      .select({
        vendorId: reviews.vendorId,
        count: sql<number>`count(*)::int`,
        average: sql<string | null>`avg(${reviews.rating})`,
      })
      .from(reviews)
      .where(and(inArray(reviews.vendorId, vendorIds), isNull(reviews.hiddenAt)))
      .groupBy(reviews.vendorId),
    /* One delivery per order, not per line: two items in one parcel arrived once. */
    db
      .select({
        vendorId: orderItems.vendorId,
        count: sql<number>`count(distinct ${orderItems.orderId})::int`,
        fast: sql<number>`(count(distinct ${orderItems.orderId}) filter (where ${orderItems.deliveredAt} <= ${orders.placedAt} + make_interval(hours => ${FAST_SHIPPING_HOURS})))::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(inArray(orderItems.vendorId, vendorIds), isNotNull(orderItems.deliveredAt), gte(orderItems.deliveredAt, since)))
      .groupBy(orderItems.vendorId),
  ]);
  const ratingBy = new Map(ratings.map(row => [row.vendorId, row]));
  const deliveryBy = new Map(deliveries.map(row => [row.vendorId, row]));
  return new Map(vendorRows.map(row => {
    const rating = ratingBy.get(row.id);
    const delivered = deliveryBy.get(row.id);
    return [row.id, storefrontBadges({
      awarded: awardedBadges(row.badges),
      reviews: Number(rating?.count ?? 0),
      averageRating: rating?.average == null ? null : Number(rating.average),
      deliveries: Number(delivered?.count ?? 0),
      fastDeliveries: Number(delivered?.fast ?? 0),
    })];
  }));
}

/* ------------------------------------------------------------ the stores --- */

/** How many stores the home page's row can hold. */
export const STORE_ROW_LIMIT = 10;
/** How many `/stores` lists — a ceiling on one read, which the page says when it reaches. */
export const STORE_INDEX_LIMIT = 200;

/** A store as the home page's "Stores on NetLet" row draws it. */
export type StoreCard = {
  slug: string;
  /** In the page's language, exactly as its products name it — the Seller filter matches on this. */
  name: string;
  logoUrl: string | null;
  /** Published products on its shelf now. */
  products: number;
  /** Only from `HIGH_RATING_MIN_REVIEWS` reviews up: one five-star review is an anecdote. */
  rating: { average: number; count: number } | null;
  badges: TrustBadge[];
};

/**
 * The stores a shopper can buy from, the busiest shelf first.
 *
 * The rule `publishedCatalog` keeps — a published product of an approved
 * store — counted per store, so a store with nothing on sale or a suspended
 * one is absent rather than a door onto an empty page. The badges are the
 * measured ones (`badgesFor`), never a value somebody typed, and the rating is
 * the same visible reviews they are measured from. The name is the products'
 * own (`pick`), because the card opens the shop filtered to that seller and the
 * filter compares names: a card spelling it differently would open a page of
 * nothing.
 */
export async function listStoreCards(locale: LocalePick = "en", limit = STORE_ROW_LIMIT): Promise<StoreCard[]> {
  const db = await getDb();
  if (!db) return [];
  const live = sql<number>`count(*)::int`;
  const rows = await db
    .select({ id: vendors.id, slug: vendors.slug, name: vendors.name, nameAr: vendors.nameAr, logoUrl: vendors.logoUrl, badges: vendors.badges, products: live })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(eq(products.status, "published"), eq(vendors.status, "approved")))
    .groupBy(vendors.id)
    /* Ends on the id, for the reason `publishedCatalog` does: two stores with
       the same count must not swap places between two page loads. */
    .orderBy(desc(live), asc(vendors.id))
    .limit(limit);
  if (!rows.length) return [];
  const [badges, ratings] = await Promise.all([badgesFor(db, rows), storeRatings(db, rows.map(row => row.id))]);
  return rows.map(row => ({
    slug: row.slug,
    name: pick(locale, row.name, row.nameAr),
    logoUrl: row.logoUrl?.trim() || null,
    products: Number(row.products),
    rating: ratings.get(row.id) ?? null,
    badges: badges.get(row.id) ?? [],
  }));
}

/**
 * Each store's rating over its visible reviews, only where there are
 * `HIGH_RATING_MIN_REVIEWS` of them — the floor the High Rating badge keeps,
 * so a store card and a store page never show an average of one review.
 */
async function storeRatings(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  vendorIds: number[],
): Promise<Map<number, { average: number; count: number }>> {
  if (!vendorIds.length) return new Map();
  const rows = await db
    .select({ vendorId: reviews.vendorId, count: sql<number>`count(*)::int`, average: sql<string | null>`avg(${reviews.rating})` })
    .from(reviews)
    .where(and(inArray(reviews.vendorId, vendorIds), isNull(reviews.hiddenAt)))
    .groupBy(reviews.vendorId);
  const rated = new Map<number, { average: number; count: number }>();
  for (const row of rows) {
    const count = Number(row.count);
    if (row.vendorId === null || row.average == null || count < HIGH_RATING_MIN_REVIEWS) continue;
    rated.set(row.vendorId, { average: Math.round(Number(row.average) * 10) / 10, count });
  }
  return rated;
}

/* --------------------------------------------------------- a store's page --- */

/**
 * How many of a store's products its page carries. A ceiling on one read, not
 * a page size: past it the page shows the newest and says how many there are.
 */
export const STORE_PAGE_PRODUCTS = 500;

/** What a store's public page says about the store — and nothing else. */
export type StoreProfile = {
  slug: string;
  name: string;
  /** The store's own words, in the page's language when it wrote both; null when it wrote none. */
  description: string | null;
  logoUrl: string | null;
  /** Where the store is, as a governorate id; null when it has not said. */
  governorate: string | null;
  /** When the store opened on NetLet. */
  since: string;
  /** Published products on its shelf now. */
  products: number;
  rating: { average: number; count: number } | null;
  badges: TrustBadge[];
  /** The store's own delivery terms (`Shared/commerce/delivery.ts`): a fee, a free-over threshold, a band. */
  delivery: {
    flat: string | null;
    freeOver: string | null;
    speed: DeliverySpeed | null;
    cashOnDelivery: boolean;
  };
};

export type StorePage = {
  store: StoreProfile;
  /** The store's live products, newest first, up to `STORE_PAGE_PRODUCTS`. */
  products: Product[];
  reviews: StoreReview[];
};

/**
 * One store's public page: an approved store, by its address.
 *
 * **What it selects is the whole privacy rule.** A vendor row carries the
 * store's email, phone, street address, licence numbers, IBAN and commission
 * — and none of them is named below, so none of them can reach a shopper by a
 * later edit to the shaping. The products come through `publishedCatalog`, so
 * the page shows exactly what the shop would: a draft, or anything at all from
 * a suspended store (which answers null here, the same as an unknown address).
 */
export async function getStorePage(slug: string, locale: LocalePick = "en"): Promise<StorePage | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      id: vendors.id,
      slug: vendors.slug,
      name: vendors.name,
      nameAr: vendors.nameAr,
      description: vendors.description,
      descriptionAr: vendors.descriptionAr,
      logoUrl: vendors.logoUrl,
      governorate: vendors.governorate,
      createdAt: vendors.createdAt,
      badges: vendors.badges,
      deliveryFlat: vendors.deliveryFlat,
      deliveryFreeOver: vendors.deliveryFreeOver,
      deliverySpeed: vendors.deliverySpeed,
      acceptsCod: vendors.acceptsCod,
    })
    .from(vendors)
    .where(and(eq(vendors.slug, slug), eq(vendors.status, "approved")))
    .limit(1);
  if (!row) return null;

  const [shelf, [counted], badges, ratings, recent] = await Promise.all([
    publishedCatalog({ vendorId: row.id, limit: STORE_PAGE_PRODUCTS }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(and(eq(products.vendorId, row.id), eq(products.status, "published"))),
    badgesFor(db, [row]),
    storeRatings(db, [row.id]),
    recentReviewsForStore(row.id),
  ]);
  const { vendorById, categoryById } = await contextFor(db, shelf);

  /* Either language rather than none: a store that wrote only Arabic still
     says something on the English page. */
  const description = (locale === "ar" ? row.descriptionAr?.trim() || row.description?.trim() : row.description?.trim() || row.descriptionAr?.trim()) || null;
  return {
    store: {
      slug: row.slug,
      name: pick(locale, row.name, row.nameAr),
      description,
      logoUrl: row.logoUrl?.trim() || null,
      governorate: row.governorate,
      since: row.createdAt.toISOString(),
      products: Number(counted?.count ?? 0),
      rating: ratings.get(row.id) ?? null,
      badges: badges.get(row.id) ?? [],
      delivery: {
        flat: row.deliveryFlat,
        freeOver: row.deliveryFreeOver,
        speed: isDeliverySpeed(row.deliverySpeed) ? row.deliverySpeed : null,
        cashOnDelivery: row.acceptsCod,
      },
    },
    products: shelf.map(product => shape(product, vendorById, categoryById, locale)),
    reviews: recent,
  };
}

type CatalogRow = Awaited<ReturnType<typeof publishedCatalog>>[number];

function shape(
  row: CatalogRow,
  vendorById: Map<number, VendorNamed>,
  categoryById: Map<number, Named>,
  locale: LocalePick,
): Product {
  const vendor = vendorById.get(row.vendorId);
  const category = row.categoryId === null ? undefined : categoryById.get(row.categoryId);
  return toStorefrontProduct(
    row,
    {
      vendorName: vendor?.name,
      vendorNameAr: vendor?.nameAr,
      vendorSlug: vendor?.slug,
      vendorBadges: vendor?.badges,
      vendorDeliverySpeed: vendor?.deliverySpeed,
      vendorDeliveryProvider: vendor?.deliveryProvider,
      vendorSubscriptionPercent: vendor?.subscriptionPercent ?? null,
      /* Checked on every read, because a permit expires on a date with nobody
         saving anything. See `Shared/inventory/discountLicence.ts`. */
      vendorDiscountLicence: vendor
        ? { number: vendor.discountLicenceNumber, expiresAt: vendor.discountLicenceExpiresAt }
        : null,
      categoryName: category?.name,
      categoryNameAr: category?.nameAr,
    },
    locale,
  );
}

/**
 * The shelf.
 *
 * `collectionHandle` narrows to one category, by slug, because that is what
 * the department pages ask for. An unknown slug returns the whole catalog
 * rather than nothing — the same choice `categoryFromSlug` makes on the
 * client, and for the same reason: an empty page reads as a broken site.
 */
export async function listProducts(
  options: { first?: number; collectionHandle?: string; locale?: LocalePick } = {},
): Promise<Product[]> {
  const db = await getDb();
  if (!db) return [];

  let categoryId: number | undefined;
  if (options.collectionHandle) {
    const [row] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, options.collectionHandle))
      .limit(1);
    categoryId = row?.id;
  }

  const rows = await publishedCatalog({ limit: options.first, categoryId });
  const { vendorById, categoryById } = await contextFor(db, rows);
  return rows.map(row => shape(row, vendorById, categoryById, options.locale ?? "en"));
}

/**
 * Named products, in the order named, dropping any the shelf would not show —
 * a draft, a suspended store's. What a sponsored placement draws (3.3.15).
 */
export async function listProductsByIds(ids: number[], locale: LocalePick = "en"): Promise<Product[]> {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  const rows = await publishedCatalog({ ids, limit: ids.length });
  const { vendorById, categoryById } = await contextFor(db, rows);
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.flatMap(id => {
    const row = byId.get(id);
    return row ? [shape(row, vendorById, categoryById, locale)] : [];
  });
}

/** One product by its slug, or null when nothing published answers to it. */
export async function getProductByHandle(
  handle: string,
  locale: LocalePick = "en",
): Promise<Product | null> {
  const db = await getDb();
  if (!db) return null;
  const row = await publishedProduct(handle);
  if (!row) return null;
  const { vendorById, categoryById } = await contextFor(db, [row]);
  return shape(row, vendorById, categoryById, locale);
}

/* ------------------------------------------------------------ departments --- */

export async function listCollections(first = 50, locale: LocalePick = "en"): Promise<Collection[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name, nameAr: categories.nameAr })
    .from(categories)
    .orderBy(categories.position, categories.name)
    .limit(first);
  return rows.map(row => toStorefrontCollection(row, locale));
}

export async function getCollectionByHandle(
  handle: string,
  locale: LocalePick = "en",
): Promise<Collection | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name, nameAr: categories.nameAr })
    .from(categories)
    .where(eq(categories.slug, handle))
    .limit(1);
  return row ? toStorefrontCollection(row, locale) : null;
}

/* --------------------------------------------------------------- the bag --- */

/**
 * Cart ids are unguessable.
 *
 * The id is the only credential a guest cart has: anyone holding it can read
 * and change that bag. A serial would make every other shopper's cart a
 * decrement away.
 */
function newCartId(): string {
  return randomBytes(24).toString("base64url");
}

function money(amount: string) {
  return { amount, currencyCode: CURRENCY };
}

/** Sum decimal strings without going through a float on the way. */
function sumMinor(values: { amount: string; quantity: number }[]): string {
  return addMoney(...values.map(({ amount, quantity }) => multiplyMoney(amount, quantity)));
}

/**
 * Read a cart back with live prices.
 *
 * A line whose variant or product has since been unpublished is dropped
 * rather than shown: the shopper cannot buy it, and a cart row they cannot
 * remove the reason for is worse than one that quietly went away.
 *
 * **A personally agreed price is applied here, and the line still stores
 * none.** A grant is a fact about a shopper and a variant, so it is looked up
 * against `carts.userId` rather than written onto `cart_items` — which keeps
 * "a cart is a list of intentions and the price is whatever it costs when the
 * shopper looks" true, with the grant simply being part of what it costs for
 * that shopper. An anonymous bag has no owner and so has no grants.
 */
export async function getCart(cartId: string): Promise<Cart | null> {
  const db = await getDb();
  if (!db) return null;

  const [cart] = await db.select().from(carts).where(eq(carts.id, cartId)).limit(1);
  if (!cart) return null;

  const rows = await db
    .select({
      lineId: cartItems.id,
      quantity: cartItems.quantity,
      bundleId: cartItems.bundleId,
      /* Which door this line is going to (3.2.6). Null is the order's own. */
      addressId: cartItems.addressId,
      /* Which trip it takes (3.2.5), and what fast costs from its store. */
      deliveryChoice: cartItems.deliveryChoice,
      fastDeliveryFee: vendors.fastDeliveryFee,
      fastDeliverySpeed: vendors.fastDeliverySpeed,
      /* The regular trip's band, so checkout can say when each parcel comes. */
      vendorDeliverySpeed: vendors.deliverySpeed,
      productDeliverySpeed: products.deliverySpeed,
      variantId: productVariants.id,
      variantTitle: productVariants.title,
      price: productVariants.price,
      stock: productVariants.stock,
      preorderStock: productVariants.preorderStock,
      preorderReleaseAt: productVariants.preorderReleaseAt,
      unit: productVariants.unit,
      stepAmount: productVariants.stepAmount,
      productHandle: products.handle,
      productTitle: products.title,
      productTitleAr: products.titleAr,
      productId: products.id,
      /* Delivery is per seller (3.2.4), so the seller comes back with the
         line rather than being looked up again per group. */
      vendorId: vendors.id,
      vendorName: vendors.name,
      vendorNameAr: vendors.nameAr,
      vendorSlug: vendors.slug,
      deliveryFlat: vendors.deliveryFlat,
      deliveryFreeOver: vendors.deliveryFreeOver,
      /* Cash on delivery is decided per seller (3.2.2). */
      acceptsCod: vendors.acceptsCod,
      codCeiling: vendors.codCeiling,
      /* A member's price (4.1) and the permit an advertised saving needs. */
      memberPrice: productVariants.memberPrice,
      licenceNumber: vendors.discountLicenceNumber,
      licenceExpiresAt: vendors.discountLicenceExpiresAt,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(eq(cartItems.cartId, cartId), eq(products.status, "published"), eq(vendors.status, "approved")))
    .orderBy(cartItems.id);

  const productIds = [...new Set(rows.map(row => row.productId))];
  const images = productIds.length
    ? await db
        .select({ productId: productImages.productId, url: productImages.url, altText: productImages.altText, kind: productImages.kind, posterUrl: productImages.posterUrl })
        .from(productImages)
        .where(inArray(productImages.productId, productIds))
        .orderBy(productImages.position, productImages.id)
    : [];
  const imageFor = new Map<number, { url: string; altText: string | null }>();
  for (const image of images) if (!imageFor.has(image.productId)) imageFor.set(image.productId, image);

  /* An agreed price is one of the reductions `shopperPrice` weighs: it holds while
     it is live, and the shelf price the moment the shelf is cheaper. */
  const agreed = await liveOffersFor(db, cart.userId, rows.map(row => row.variantId));
  /* An anonymous bag has no owner and so no membership, like no agreed price. */
  const member = await isMemberNow(db, cart.userId);

  /*
   * What the bundles in this basket make each line cost (3.3.11), by the same
   * function `placeOrder` uses. Two implementations of this is precisely how a
   * checkout summary comes to disagree with the bill.
   */
  const bundled = await bundlePricing(db, rows.map(row => ({
    variantId: row.variantId,
    quantity: row.quantity,
    bundleId: row.bundleId,
  })));

  /*
   * The optional extras each line carries (3.1.2), priced from the catalog on
   * every read — `cart_item_addons` stores which, never what they cost, which
   * is the same rule that keeps a cart free of prices.
   */
  const lineIds = rows.map(row => row.lineId);
  const chosenAddons = lineIds.length
    ? await db
        .select({
          lineId: cartItemAddons.cartItemId,
          id: productAddons.id,
          kind: productAddons.kind,
          label: productAddons.label,
          labelAr: productAddons.labelAr,
          price: productAddons.price,
        })
        .from(cartItemAddons)
        .innerJoin(productAddons, eq(productAddons.id, cartItemAddons.addonId))
        .where(inArray(cartItemAddons.cartItemId, lineIds))
        .orderBy(productAddons.position, productAddons.id)
    : [];

  /*
   * The shopper's address book, and which of them this basket points at
   * (3.2.6). Both empty for a guest — an anonymous bag has no owner, so it has
   * no book and the whole control is absent rather than broken.
   */
  const book = cart.userId ? await listAddresses(cart.userId) : [];
  const doors = new Map(book.map(address => [address.id, address]));

  const priced = rows.map(row => {
    const extras = chosenAddons.filter(addon => addon.lineId === row.lineId);
    const inBundle = bundled.get(row.variantId);
    /* `shopperPrice` is the one rule checkout uses too, so the bag cannot
       quote a figure the order then charges differently. */
    const price = shopperPrice({
      listPrice: row.price,
      bundlePrice: inBundle?.unitPrice ?? null,
      agreed: agreed.get(row.variantId) ?? null,
      memberPrice: memberPriceFor({
        member,
        listPrice: row.price,
        memberPrice: row.memberPrice,
        permitValid: discountAllowed({ number: row.licenceNumber, expiresAt: row.licenceExpiresAt }).allowed,
      }),
    });
    return {
      ...row,
      inBundle,
      charged: price.charged,
      reason: price.reason,
      extras,
      extrasTotal: addonsTotal(
        extras.map(addon => ({ id: addon.id, kind: addon.kind as AddonKind, label: addon.label, price: addon.price })),
        row.quantity,
      ),
    };
  });

  const items: CartItem[] = priced.map(row => ({
    lineId: String(row.lineId),
    variantId: String(row.variantId),
    productId: String(row.productId),
    productHandle: row.productHandle,
    productTitle: row.productTitle,
    productTitleAr: row.productTitleAr?.trim() || null,
    variantTitle: row.variantTitle,
    image: imageFor.get(row.productId) ?? null,
    unitPrice: money(row.charged),
    /* The shelf price beside it, but only when it is genuinely higher — this
       is the one place a shopper is shown what they are saving, because they
       asked for it. It is never `compareAtPrice`: that field drives the public
       strikethrough and the `−27%` badge, which are the machinery of an
       advertised claim and need a Ministry permit this does not. */
    agreedFrom: row.charged === row.price || row.inBundle ? null : money(row.price),
    priceReason: row.reason === "agreed" || row.reason === "member" || row.reason === "subscriber" ? row.reason : null,
    /* Named on the line, because a shopper who sees a lower figure should be
       able to see which set put it there. */
    bundleName: row.inBundle?.bundleName ?? null,
    /* Only a door still in the book: an address deleted since leaves the line
       going where the order goes, which is what `set null` already arranged. */
    destination: row.addressId && doors.has(row.addressId)
      ? { id: row.addressId, label: doors.get(row.addressId)!.label }
      : null,
    /* A line the shelf cannot cover is a pre-order (stock first, never
       split), and a pre-order's promise is its release date, not a band. */
    deliverySpeed: speedForLine(
      { preordered: row.stock < row.quantity && (row.preorderStock ?? 0) >= row.quantity },
      row.vendorDeliverySpeed,
      row.productDeliverySpeed,
    ),
    deliveryChoice: effectiveChoice(row.deliveryChoice, { fastFlat: row.fastDeliveryFee }),
    fastDelivery: offersFast({ fastFlat: row.fastDeliveryFee })
      ? { fee: money(row.fastDeliveryFee!), speed: isDeliverySpeed(row.fastDeliverySpeed) ? row.fastDeliverySpeed : null }
      : null,
    quantity: row.quantity,
    vendor: { id: row.vendorId, name: row.vendorName, nameAr: row.vendorNameAr?.trim() || null, slug: row.vendorSlug },
    measure: { unit: row.unit as Measure["unit"], stepAmount: Number(row.stepAmount) },
    addons: row.extras.map(addon => ({
      id: String(addon.id),
      kind: addon.kind,
      label: addon.label,
      price: money(addon.price),
    })),
    addonsTotal: row.extras.length ? money(row.extrasTotal) : null,
    /* The extras are part of what this line costs, so they are inside the
       line total rather than a figure somebody has to add up themselves. */
    lineTotal: money(addMoney(sumMinor([{ amount: row.charged, quantity: row.quantity }]), row.extrasTotal)),
  }));

  const subtotal = addMoney(
    sumMinor(priced.map(row => ({ amount: row.charged, quantity: row.quantity }))),
    ...priced.map(row => row.extrasTotal),
  );
  const quoted = deliveryFor(priced, doors);
  /* Waived the way checkout waives it (4.1), so the bag shows what the order will charge. */
  const minimum = member ? await freeDeliveryOver(db) : null;
  const quote = member ? waiveDelivery(quoted, subtotal, minimum) : { ...quoted, waived: "0.000" };
  /* Whether every trip on this bag is NetLet's to carry, fast included (4.1):
     the line's Fast choice then says "free" rather than a fee nobody pays. */
  const memberFree = member && (minimum === null || compareMoney(subtotal, minimum) >= 0);
  /* One row per seller, so the COD rules line up with the delivery groups. */
  const rules = new Map(priced.map(row => [row.vendorId, { accepts: row.acceptsCod, ceiling: row.codCeiling }]));

  return {
    id: cart.id,
    // NetLet checks out on NetLet. There is no external host to hand the
    // shopper to any more, so this is a path the client navigates to.
    checkoutUrl: "/checkout",
    items,
    itemCount: items.reduce((count, item) => count + item.quantity, 0),
    subtotal: money(subtotal),
    /*
     * Whether this is a basket somebody forgot (3.1.17). Resolved on the read
     * rather than sent by a job, because there is no scheduler and no mail
     * provider — a reminder that depends on a cron nobody runs is a dead
     * feature that looks finished.
     */
    recovery: recoveryFor({ updatedAt: cart.updatedAt, itemCount: items.reduce((n, item) => n + item.quantity, 0) }),
    /* Whether the one payment method NetLet can take today is available on
       this basket, and if not, which seller refused and why. */
    cod: codAvailability(
      quote.perVendor.map(row => ({
        vendorName: row.vendorName,
        goods: row.goods,
        rule: {
          accepts: rules.get(row.vendorId ?? -1)?.accepts ?? true,
          ceiling: rules.get(row.vendorId ?? -1)?.ceiling ?? null,
        },
      })),
      await featureOn("cashOnDelivery"),
    ),
    addresses: book.map(address => ({ id: address.id, label: address.label })),
    delivery: {
      perVendor: quote.perVendor.map(row => ({
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        /* Both names, for the reason a line carries both titles: the bag has
           no language, and the page picks. */
        vendorNameAr: rows.find(line => line.vendorId === row.vendorId)?.vendorNameAr?.trim() || null,
        destinationLabel: row.destinationLabel ?? null,
        ...(row.choice === "fast" ? { choice: "fast" as const } : {}),
        goods: money(row.goods),
        fee: money(row.fee),
        free: row.free,
        toFree: row.toFree === null ? null : money(row.toFree),
      })),
      total: money(quote.total),
      memberWaived: quote.waived !== "0.000" ? money(quote.waived) : null,
      memberFree,
    },
    total: money(addMoney(subtotal, quote.total)),
  };
}

/**
 * Group the priced lines into parcels and ask what each costs to deliver.
 *
 * A parcel is a seller **and a destination** (3.2.6): two doors are two
 * journeys out of one warehouse, and charging once for both would hand a
 * seller's van out for free. The fold itself is pure and lives in
 * `Shared/commerce/delivery.ts`, so the case worth checking — one seller, two
 * doors, and a threshold their combined total would have cleared — can be
 * exercised without a database.
 */
function deliveryFor(
  rows: {
    vendorId: number; vendorName: string; deliveryFlat: string | null; deliveryFreeOver: string | null;
    fastDeliveryFee?: string | null; deliveryChoice?: string | null;
    charged: string; quantity: number; extrasTotal?: string; addressId?: number | null;
  }[],
  doors: Map<number, { label: string }>,
) {
  const rules = new Map<number | null, DeliveryRule>();
  for (const row of rows) rules.set(row.vendorId, { flat: row.deliveryFlat, freeOver: row.deliveryFreeOver, fastFlat: row.fastDeliveryFee ?? null });

  const lines: DestinedLine[] = rows.map(row => {
    /* The extras count toward a seller's free-delivery threshold: they are
       money spent with that seller, the same as an agreed price is. */
    const value = addMoney(multiplyMoney(row.charged, row.quantity), row.extrasTotal ?? "0.000");
    const destinationId = row.addressId && doors.has(row.addressId) ? row.addressId : null;
    return {
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      destinationId,
      destinationLabel: destinationId ? doors.get(destinationId)!.label : null,
      value,
      choice: row.deliveryChoice === "fast" ? "fast" : "regular",
    };
  });

  return quoteDelivery(groupForDelivery(lines, rules));
}

/**
 * A line as the client asks for it.
 *
 * `addonIds` are the optional extras the shopper ticked (3.1.2) — ids only,
 * because the price comes from the catalog and anything the client says about
 * money is discarded.
 */
type Line = { variantId: string; quantity: number; addonIds?: string[]; bundleId?: number };

/**
 * Only a buyable variant may enter a cart.
 *
 * Checked here rather than trusted from the client, because the variant id
 * arrives from the browser and "add a variant of an unpublished product" is
 * otherwise a valid request.
 */
async function buyableVariantIds(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  ids: number[],
): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(
      and(
        inArray(productVariants.id, ids),
        eq(products.status, "published"),
        eq(vendors.status, "approved"),
      ),
    );
  return new Set(rows.map(row => row.id));
}

async function putLines(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  cartId: string,
  lines: Line[],
) {
  const wanted = lines
    .map(line => ({
      variantId: Number(line.variantId),
      quantity: line.quantity,
      addonIds: (line.addonIds ?? []).map(Number).filter(Number.isInteger),
      bundleId: line.bundleId ?? null,
    }))
    .filter(line => Number.isInteger(line.variantId) && line.quantity > 0);
  const buyable = await buyableVariantIds(db, wanted.map(line => line.variantId));

  for (const line of wanted) {
    if (!buyable.has(line.variantId)) continue;
    // Adding the same variant twice adds to the line rather than growing a
    // second one — which is what the composite unique is for.
    const [row] = await db
      .insert(cartItems)
      .values({ cartId, variantId: line.variantId, quantity: line.quantity, bundleId: line.bundleId })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.variantId],
        /* Adding a bundled line over a plain one marks it as bundled; adding a
           plain one over a bundled line leaves the bundle alone, because the
           set is still in the basket and buying another of one member should
           not cancel it. */
        set: {
          quantity: sql`least(${cartItems.quantity} + ${line.quantity}, ${MAX_LINE_QUANTITY})`,
          bundleId: line.bundleId ?? sql`${cartItems.bundleId}`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: cartItems.id });

    if (line.addonIds.length === 0 || !row) continue;

    /*
     * Only extras this product actually offers, so an id from another seller's
     * listing cannot be attached to this line — the same reason the price is
     * read here rather than taken from the caller.
     */
    const offered = await db
      .select({ id: productAddons.id })
      .from(productAddons)
      .innerJoin(productVariants, eq(productVariants.productId, productAddons.productId))
      .where(and(inArray(productAddons.id, line.addonIds), eq(productVariants.id, line.variantId)));

    if (offered.length === 0) continue;
    /* Ticking the same extra twice is one extra: the unique index decides, so
       two tabs cannot both attach it. */
    await db
      .insert(cartItemAddons)
      .values(offered.map(addon => ({ cartItemId: row.id, addonId: addon.id })))
      .onConflictDoNothing();
  }
}

export async function createCart(lines: Line[], userId?: number | null): Promise<Cart | null> {
  const db = await getDb();
  if (!db) return null;
  const id = newCartId();
  await db.insert(carts).values({ id, userId: userId ?? null });
  await putLines(db, id, lines);
  return getCart(id);
}

export async function addCartLines(cartId: string, lines: Line[]): Promise<Cart | null> {
  const db = await getDb();
  if (!db) return null;
  const [cart] = await db.select({ id: carts.id }).from(carts).where(eq(carts.id, cartId)).limit(1);
  if (!cart) return null;
  await putLines(db, cartId, lines);
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
  return getCart(cartId);
}

export async function updateCartLines(
  cartId: string,
  lines: { lineId: string; quantity: number }[],
): Promise<Cart | null> {
  const db = await getDb();
  if (!db) return null;
  for (const line of lines) {
    const lineId = Number(line.lineId);
    if (!Number.isInteger(lineId) || line.quantity < 1) continue;
    // Scoped by cartId as well as line id: a line id from another shopper's
    // cart must not be editable by guessing it.
    await db
      .update(cartItems)
      .set({ quantity: line.quantity, updatedAt: new Date() })
      .where(and(eq(cartItems.id, lineId), eq(cartItems.cartId, cartId)));
  }
  return getCart(cartId);
}

export async function removeCartLines(cartId: string, lineIds: string[]): Promise<Cart | null> {
  const db = await getDb();
  if (!db) return null;
  const ids = lineIds.map(Number).filter(Number.isInteger);
  if (ids.length) {
    await db.delete(cartItems).where(and(inArray(cartItems.id, ids), eq(cartItems.cartId, cartId)));
  }
  return getCart(cartId);
}

/**
 * Choose the trip one line takes (3.2.5). Scoped by the cart, like every other
 * write to a bag, so a guessed line id edits nothing. Fast on a store that
 * offers no fast trip is stored as asked and read as regular
 * (`effectiveChoice`), so a store adding a fast fee later does not change a
 * line nobody touched.
 */
export async function setLineDeliveryChoice(cartId: string, lineId: string, choice: "regular" | "fast"): Promise<Cart | null> {
  const db = await getDb();
  if (!db) return null;
  const id = Number(lineId);
  if (Number.isInteger(id)) {
    await db.update(cartItems).set({ deliveryChoice: choice }).where(and(eq(cartItems.id, id), eq(cartItems.cartId, cartId)));
  }
  return getCart(cartId);
}

/**
 * Attach a guest cart to an account on sign-in, and say whose it is now.
 *
 * The bag a shopper filled before signing in is theirs; replacing it with the
 * empty one on their account would throw away the reason they signed in. Only
 * an unowned bag is taken — one that already belongs to an account stays with
 * it, which is what stops somebody signing in on a device where another
 * shopper's bag was left from walking off with it.
 *
 * This existed from the start and nothing called it, so a bag filled before
 * signing in stayed nobody's: it never showed the shopper's agreed or member
 * prices, which are read against the bag's owner, and the account's pointer to
 * it was a pointer to a stranger's bag as far as the shop could tell.
 */
export async function claimCart(cartId: string, userId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  await db.update(carts).set({ userId }).where(and(eq(carts.id, cartId), sql`${carts.userId} is null`));
  const [row] = await db.select({ userId: carts.userId }).from(carts).where(eq(carts.id, cartId)).limit(1);
  return row?.userId ?? null;
}
