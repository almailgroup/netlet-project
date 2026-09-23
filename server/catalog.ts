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
 *   is enforced in `server/inventory.ts`, not repeated here, so suspension
 *   stays a single lever rather than a rule copied into two files.
 * - Cart prices are read at read time, never stored. See `cartItems` in the
 *   schema for why.
 */

import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  cartItems,
  carts,
  categories,
  productImages,
  products,
  productVariants,
  vendors,
} from "../drizzle/schema.js";
import {
  CURRENCY,
  toStorefrontCollection,
  toStorefrontProduct,
  type LocalePick,
} from "../shared/commerce/fromInventory.js";
import type { Cart, CartItem, Collection, Product } from "../shared/commerce/types.js";
import type { Measure } from "../shared/commerce/units.js";
import { publishedCatalog, publishedProduct } from "./inventory.js";
import { getDb } from "./db.js";
import { addMoney, multiplyMoney } from "../shared/money.js";
import { priceFor } from "../shared/commerce/priceOffers.js";
import { quoteDelivery, type DeliveryGroup } from "../shared/commerce/delivery.js";
import { liveOffersFor } from "./offers.js";

/* ------------------------------------------------------------- the shelf --- */

type Named = { id: number; name: string; nameAr: string | null };
/** A vendor also carries its awarded badges, which a category has no analogue of. */
type VendorNamed = Named & {
  badges: string[] | null;
  discountLicenceNumber: string | null;
  discountLicenceExpiresAt: Date | null;
  /* The store's usual shipping band, which a product may override (3.2.5). */
  deliverySpeed: string | null;
  deliveryProvider: string | null;
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
      ? db.select({ id: vendors.id, name: vendors.name, nameAr: vendors.nameAr, badges: vendors.badges, discountLicenceNumber: vendors.discountLicenceNumber, discountLicenceExpiresAt: vendors.discountLicenceExpiresAt, deliverySpeed: vendors.deliverySpeed, deliveryProvider: vendors.deliveryProvider }).from(vendors).where(inArray(vendors.id, vendorIds))
      : Promise.resolve([] as VendorNamed[]),
    categoryIds.length
      ? db.select({ id: categories.id, name: categories.name, nameAr: categories.nameAr }).from(categories).where(inArray(categories.id, categoryIds))
      : Promise.resolve([] as Named[]),
  ]);

  const vendorById = new Map(vendorRows.map(row => [row.id, row]));
  const categoryById = new Map(categoryRows.map(row => [row.id, row]));
  return { vendorById, categoryById };
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
      vendorBadges: vendor?.badges,
      vendorDeliverySpeed: vendor?.deliverySpeed,
      vendorDeliveryProvider: vendor?.deliveryProvider,
      /* Checked on every read, because a permit expires on a date with nobody
         saving anything. See `shared/inventory/discountLicence.ts`. */
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
      deliveryFlat: vendors.deliveryFlat,
      deliveryFreeOver: vendors.deliveryFreeOver,
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
        .orderBy(productImages.position)
    : [];
  const imageFor = new Map<number, { url: string; altText: string | null }>();
  for (const image of images) if (!imageFor.has(image.productId)) imageFor.set(image.productId, image);

  /* `priceFor` decides what each line actually costs: the agreed price while
     it is live, and the shelf price the moment the shelf is cheaper. */
  const agreed = await liveOffersFor(db, cart.userId, rows.map(row => row.variantId));
  const priced = rows.map(row => ({
    ...row,
    charged: priceFor(row.price, agreed.get(row.variantId) ?? null),
  }));

  const items: CartItem[] = priced.map(row => ({
    lineId: String(row.lineId),
    variantId: String(row.variantId),
    productHandle: row.productHandle,
    productTitle: row.productTitle,
    variantTitle: row.variantTitle,
    image: imageFor.get(row.productId) ?? null,
    unitPrice: money(row.charged),
    /* The shelf price beside it, but only when it is genuinely higher — this
       is the one place a shopper is shown what they are saving, because they
       asked for it. It is never `compareAtPrice`: that field drives the public
       strikethrough and the `−27%` badge, which are the machinery of an
       advertised claim and need a Ministry permit this does not. */
    agreedFrom: row.charged === row.price ? null : money(row.price),
    quantity: row.quantity,
    measure: { unit: row.unit as Measure["unit"], stepAmount: Number(row.stepAmount) },
    lineTotal: money(sumMinor([{ amount: row.charged, quantity: row.quantity }])),
  }));

  const subtotal = sumMinor(priced.map(row => ({ amount: row.charged, quantity: row.quantity })));
  const quote = deliveryFor(priced);

  return {
    id: cart.id,
    // NetLet checks out on NetLet. There is no external host to hand the
    // shopper to any more, so this is a path the client navigates to.
    checkoutUrl: "/checkout",
    items,
    itemCount: items.reduce((count, item) => count + item.quantity, 0),
    subtotal: money(subtotal),
    delivery: {
      perVendor: quote.perVendor.map(row => ({
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        goods: money(row.goods),
        fee: money(row.fee),
        free: row.free,
        toFree: row.toFree === null ? null : money(row.toFree),
      })),
      total: money(quote.total),
    },
    total: money(addMoney(subtotal, quote.total)),
  };
}

/**
 * Group the priced lines by seller and ask what each charges to deliver.
 *
 * Grouped here rather than in `shared/`, because the grouping needs the rows
 * the query returned; the arithmetic on top of it is pure and lives in
 * `shared/commerce/delivery.ts`, which is what makes it checkable.
 */
function deliveryFor(rows: {
  vendorId: number; vendorName: string; deliveryFlat: string | null; deliveryFreeOver: string | null;
  charged: string; quantity: number;
}[]) {
  const groups = new Map<number, DeliveryGroup>();
  for (const row of rows) {
    const held = groups.get(row.vendorId);
    const line = multiplyMoney(row.charged, row.quantity);
    if (held) held.goods = addMoney(held.goods, line);
    else {
      groups.set(row.vendorId, {
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        goods: line,
        rule: { flat: row.deliveryFlat, freeOver: row.deliveryFreeOver },
      });
    }
  }
  return quoteDelivery([...groups.values()]);
}

type Line = { variantId: string; quantity: number };

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
    .map(line => ({ variantId: Number(line.variantId), quantity: line.quantity }))
    .filter(line => Number.isInteger(line.variantId) && line.quantity > 0);
  const buyable = await buyableVariantIds(db, wanted.map(line => line.variantId));

  for (const line of wanted) {
    if (!buyable.has(line.variantId)) continue;
    // Adding the same variant twice adds to the line rather than growing a
    // second one — which is what the composite unique is for.
    await db
      .insert(cartItems)
      .values({ cartId, variantId: line.variantId, quantity: line.quantity })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.variantId],
        set: { quantity: sql`${cartItems.quantity} + ${line.quantity}`, updatedAt: new Date() },
      });
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
 * Attach a guest cart to an account on sign-in.
 *
 * The bag a shopper filled before signing in is theirs; replacing it with the
 * empty one on their account would throw away the reason they signed in.
 */
export async function claimCart(cartId: string, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(carts).set({ userId }).where(and(eq(carts.id, cartId), sql`${carts.userId} is null`));
}
