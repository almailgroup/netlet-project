/**
 * Bundles, the half that needs a database.
 *
 * `shared/commerce/bundles.ts` is the arithmetic and is pure — including the
 * part that matters, how a saving is split across two shops. This is what
 * cannot be: reading a bundle's members at their live prices, deciding whether
 * the permit behind it is valid *now*, and writing one.
 *
 * Outside `db.ts` for the reason `orders.ts`, `fraud.ts` and `applications.ts`
 * are: functions inside it reach its module-local `getDb`, which nothing
 * outside can redirect, so anything living there cannot be tested against a
 * real database.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { bundleItems, bundles, productVariants, products, vendors } from "../drizzle/schema.js";
import {
  isSellableBundle,
  chargedTotal,
  savingOf,
  separatelyTotal,
  splitBundlePrice,
  type Bundle,
} from "../shared/commerce/bundles.js";
import { multiplyMoney } from "../shared/money.js";
import { discountAllowed } from "../shared/inventory/discountLicence.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * A bundle as a page draws it.
 *
 * `Omit` rather than an intersection: intersecting `members` with a richer
 * array type leaves the original element type winning, so the extra fields are
 * invisible to every caller — which TypeScript reports at the call site rather
 * than here, a long way from the cause.
 */
export type BundleView = Omit<Bundle, "members"> & {
  /** Whether it is on the shelf, so the portal's toggle knows which way to go. */
  active: boolean;
  separately: string;
  saving: string;
  crossVendor: boolean;
  members: (Bundle["members"][number] & {
    productHandle: string;
    productTitle: string;
    variantTitle: string | null;
    vendorName: string | null;
    availableForSale: boolean;
    /** What one of these costs inside the set, and what the line comes to. */
    bundleUnitPrice: string;
    lineTotal: string;
  })[];
};

/**
 * Load bundles with their members priced from the catalog.
 *
 * `onlySellable` is what the storefront asks for: a bundle is on the shelf
 * only while it is active, every member is published and buyable, it still
 * saves something, and — the rule a page cannot be trusted to remember — the
 * Ministry permit behind it is valid **now**. That last one is checked here
 * rather than at the write, exactly as `fromInventory` drops `compareAtPrice`,
 * because a permit lapses on a Tuesday with nobody saving anything.
 */
export async function loadBundles(
  db: Db,
  options: { ids?: number[]; vendorId?: number; variantId?: number; onlySellable?: boolean } = {},
): Promise<BundleView[]> {
  const scope = [
    options.ids ? inArray(bundles.id, options.ids) : undefined,
    options.vendorId !== undefined ? eq(bundles.vendorId, options.vendorId) : undefined,
    options.onlySellable ? eq(bundles.active, true) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      bundle: bundles,
      licenceNumber: vendors.discountLicenceNumber,
      licenceExpiresAt: vendors.discountLicenceExpiresAt,
    })
    .from(bundles)
    .leftJoin(vendors, eq(vendors.id, bundles.vendorId))
    .where(scope.length ? and(...scope) : undefined)
    .orderBy(desc(bundles.createdAt), desc(bundles.id));

  if (rows.length === 0) return [];

  const members = await db
    .select({
      bundleId: bundleItems.bundleId,
      variantId: productVariants.id,
      quantity: bundleItems.quantity,
      position: bundleItems.position,
      unitPrice: productVariants.price,
      stock: productVariants.stock,
      preorderStock: productVariants.preorderStock,
      variantTitle: productVariants.title,
      productHandle: products.handle,
      productTitle: products.title,
      productStatus: products.status,
      vendorId: vendors.id,
      vendorName: vendors.name,
      vendorStatus: vendors.status,
    })
    .from(bundleItems)
    .innerJoin(productVariants, eq(productVariants.id, bundleItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(inArray(bundleItems.bundleId, rows.map(row => row.bundle.id)))
    .orderBy(asc(bundleItems.position), asc(bundleItems.id));

  const views: BundleView[] = [];
  for (const row of rows) {
    const mine = members.filter(member => member.bundleId === row.bundle.id);

    if (options.onlySellable) {
      /* Every member has to be on the shelf and buyable: a bundle where one of
         three cannot be bought is the dead-control rule at the size of a set. */
      const buyable = mine.every(
        member =>
          member.productStatus === "published" &&
          member.vendorStatus === "approved" &&
          member.stock + member.preorderStock > 0,
      );
      if (!buyable || mine.length === 0) continue;

      /*
       * The permit. A seller's own bundle needs theirs; NetLet's own
       * (`vendorId` null) is the platform's promotion, the same distinction
       * the discount codes make, and it carries no vendor permit to check.
       */
      if (row.bundle.vendorId !== null) {
        const verdict = discountAllowed({ number: row.licenceNumber, expiresAt: row.licenceExpiresAt });
        if (!verdict.allowed) continue;
      }
    }

    const view: BundleView = {
      id: row.bundle.id,
      name: row.bundle.name,
      nameAr: row.bundle.nameAr,
      vendorId: row.bundle.vendorId,
      bundlePrice: row.bundle.bundlePrice,
      active: row.bundle.active,
      members: mine.map(member => ({
        variantId: member.variantId,
        vendorId: member.vendorId,
        quantity: member.quantity,
        unitPrice: member.unitPrice,
        productHandle: member.productHandle,
        productTitle: member.productTitle,
        variantTitle: member.variantTitle,
        vendorName: member.vendorName,
        availableForSale: member.stock + member.preorderStock > 0,
        /* Filled by the split below; a member cannot know its own share. */
        bundleUnitPrice: member.unitPrice,
        lineTotal: multiplyMoney(member.unitPrice, member.quantity),
      })),
      separately: "0.000",
      saving: "0.000",
      crossVendor: new Set(mine.map(member => member.vendorId)).size > 1,
    };
    view.separately = separatelyTotal(view.members);

    /*
     * **Split once, here, and quoted at what it will actually charge.**
     *
     * The split prices each member per unit and rounds down, so the parts can
     * come to a fil or two under the figure the seller typed — one fil per
     * unit at worst. The offer used to print the seller's figure while the bag
     * summed the parts, so a set advertised at KWD 90.000 was billed at
     * 89.997: two numbers for one price, and the one the shopper agreed to was
     * not the one they paid.
     *
     * Rounding the other way cannot fix it. `lineTotal = unitPrice × quantity`
     * is an identity the order arithmetic holds exactly, and three units
     * cannot share seven fils evenly however they are rounded. So the shop
     * quotes the sum of the parts — the seller's price or a hair under it,
     * never over.
     *
     * The split is done **once** and carried on the members, rather than
     * recomputed by whoever needs it. Quoting the reduced figure while the
     * pricing path re-split it from scratch took the fils off twice, which is
     * what the first attempt at this did: 90.000 became 89.997 on the page and
     * 89.995 in the bag. One split, one set of numbers.
     */
    const priced = splitBundlePrice(view);
    const shareOf = new Map(priced.map(share => [share.variantId, share]));
    for (const member of view.members) {
      const share = shareOf.get(member.variantId);
      member.bundleUnitPrice = share?.bundleUnitPrice ?? member.unitPrice;
      member.lineTotal = share?.lineTotal ?? multiplyMoney(member.unitPrice, member.quantity);
    }
    view.bundlePrice = chargedTotal(priced);
    view.saving = savingOf(view);

    /* A bundle that saves nothing is a set of products with a heading. */
    if (options.onlySellable && !isSellableBundle(view)) continue;
    views.push(view);
  }

  return views;
}

/** The bundles a shopper could buy that contain this variant. */
export async function bundlesForVariant(variantId: number): Promise<BundleView[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ bundleId: bundleItems.bundleId })
    .from(bundleItems)
    .where(eq(bundleItems.variantId, variantId));
  if (rows.length === 0) return [];
  return loadBundles(db, { ids: rows.map(row => row.bundleId), onlySellable: true });
}

/**
 * What each line of a basket costs once its bundles are applied.
 *
 * Returns a price per cart line, or nothing when no bundle is in play. The
 * saving applies **only while every member is present at the quantity the
 * bundle names** — take one out and the rest go back to their own prices,
 * because two thirds of a bundle is a discount nobody agreed to.
 */
export async function bundlePricing(
  db: Db,
  lines: { variantId: number; quantity: number; bundleId: number | null }[],
): Promise<Map<number, { unitPrice: string; bundleId: number; bundleName: string }>> {
  const priced = new Map<number, { unitPrice: string; bundleId: number; bundleName: string }>();
  const bundleIds = [...new Set(lines.map(line => line.bundleId).filter((id): id is number => id !== null))];
  if (bundleIds.length === 0) return priced;

  const loaded = await loadBundles(db, { ids: bundleIds });

  for (const bundle of loaded) {
    const mine = lines.filter(line => line.bundleId === bundle.id);
    /* Every member, at the quantity the bundle names. */
    const complete = bundle.members.every(member =>
      mine.some(line => line.variantId === member.variantId && line.quantity >= member.quantity),
    );
    if (!complete) continue;

    for (const member of bundle.members) {
      /* The share `loadBundles` already worked out. Re-splitting here is what
         made the page and the bag disagree, and a per-unit figure is what
         everything downstream wants anyway — the line total, the commission
         split and the delivery grouping all multiply by quantity themselves. */
      priced.set(member.variantId, {
        unitPrice: member.bundleUnitPrice,
        bundleId: bundle.id,
        bundleName: bundle.name,
      });
    }
  }

  return priced;
}

/* --------------------------------------------------------------- writing --- */

export class BundleError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

/**
 * Create or replace a bundle.
 *
 * A vendor may only bundle **their own** goods; a cross-vendor bundle is
 * NetLet's own merchandising and takes `platform.viewAll`. That is the same
 * split the discount codes make, and for the same reason: a seller who could
 * put another shop's product into a discounted set would be spending money
 * that is not theirs.
 */
export async function saveBundle(
  actor: Actor,
  input: {
    id?: number;
    name: string;
    nameAr?: string | null;
    vendorId: number | null;
    bundlePrice: string;
    active?: boolean;
    members: { variantId: number; quantity: number }[];
  },
): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  if (input.vendorId === null) assertCan(actor, "platform.viewAll");
  else assertCan(actor, "product.edit", input.vendorId);

  /*
   * An edit is checked against the bundle as it stands, not only against the
   * store the request names. It was checked against the request alone, so a
   * seller who sent another store's bundle id — or one of NetLet's own — with
   * their own store on it rewrote that bundle into theirs: its name, its price
   * and every item in it.
   */
  if (input.id) {
    const [current] = await db.select({ vendorId: bundles.vendorId }).from(bundles).where(eq(bundles.id, input.id)).limit(1);
    if (!current) throw new BundleError("bundle.unknown");
    if (current.vendorId === null) assertCan(actor, "platform.viewAll");
    else assertCan(actor, "product.edit", current.vendorId);
  }

  if (input.members.length < 2) throw new BundleError("bundle.tooFew");

  /* Where every member actually comes from, read rather than trusted. */
  const owners = await db
    .select({ variantId: productVariants.id, vendorId: products.vendorId, price: productVariants.price })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, input.members.map(member => member.variantId)));

  if (owners.length !== input.members.length) throw new BundleError("bundle.unknownItem");

  if (input.vendorId !== null && owners.some(owner => owner.vendorId !== input.vendorId)) {
    /* A seller bundling somebody else's goods would be discounting a shop that
       never agreed to it. */
    throw new BundleError("bundle.notYours");
  }

  const separately = separatelyTotal(
    input.members.map(member => ({
      variantId: member.variantId,
      vendorId: null,
      quantity: member.quantity,
      unitPrice: owners.find(owner => owner.variantId === member.variantId)!.price,
    })),
  );
  /* A bundle that saves nothing needs no permit and is no bundle. Refused at
     the write as well as hidden on the read, because a seller who typed the
     wrong figure should be told rather than left wondering where it went. */
  if (Number.parseFloat(input.bundlePrice) >= Number.parseFloat(separately)) throw new BundleError("bundle.noSaving");

  const values = {
    name: input.name.trim(),
    nameAr: input.nameAr?.trim() || null,
    vendorId: input.vendorId,
    bundlePrice: input.bundlePrice,
    active: input.active ?? true,
  };

  /* One transaction: the items are replaced by a delete and an insert, and a
     failure between them left a bundle selling at its set price with nothing
     in it. */
  return db.transaction(async tx => {
    const id = input.id
      ? (await tx.update(bundles).set(values).where(eq(bundles.id, input.id)).returning({ id: bundles.id }))[0]?.id
      : (await tx.insert(bundles).values(values).returning({ id: bundles.id }))[0].id;
    if (!id) throw new BundleError("bundle.unknown");

    /* The whole list at once, like the product images: a bundle is read as a set
       and a per-row endpoint turns reordering two of them into four calls. */
    await tx.delete(bundleItems).where(eq(bundleItems.bundleId, id));
    await tx.insert(bundleItems).values(
      input.members.map((member, position) => ({
        bundleId: id,
        variantId: member.variantId,
        quantity: Math.max(1, Math.trunc(member.quantity)),
        position,
      })),
    );
    return { id };
  });
}

/** Every bundle the caller may see, for the portal's list. */
export async function listBundles(actor: Actor): Promise<BundleView[]> {
  const db = await getDb();
  if (!db) return [];
  if (actor.kind === "admin") {
    assertCan(actor, "platform.viewAll");
    return loadBundles(db);
  }
  /* A shopper has no store to list bundles for, and `assertCan` would refuse
     them anyway — this is the shape check that lets the vendor branch read
     `vendorId` at all. */
  if (actor.kind !== "vendor") return [];
  assertCan(actor, "product.view", actor.vendorId);
  return loadBundles(db, { vendorId: actor.vendorId });
}

/** Take one off the shelf, or put it back. */
export async function setBundleActive(actor: Actor, bundleId: number, active: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [row] = await db.select({ vendorId: bundles.vendorId }).from(bundles).where(eq(bundles.id, bundleId)).limit(1);
  if (!row) throw new BundleError("bundle.unknown");

  if (row.vendorId === null) assertCan(actor, "platform.viewAll");
  else assertCan(actor, "product.edit", row.vendorId);

  await db.update(bundles).set({ active }).where(eq(bundles.id, bundleId));
}
