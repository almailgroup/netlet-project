/**
 * Bundles, the half that needs a database.
 *
 * `Shared/commerce/bundles.ts` is the arithmetic and is pure — including the
 * part that matters, how a saving is split across two shops. This is what
 * cannot be: reading a bundle's members at their live prices, deciding whether
 * the permit behind it is valid *now*, and writing one.
 *
 * Outside `db.ts` for the reason `orders.ts`, `fraud.ts` and `applications.ts`
 * are: functions inside it reach its module-local `getDb`, which nothing
 * outside can redirect, so anything living there cannot be tested against a
 * real database.
 */
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { bundleAgreements, bundleItems, bundles, productVariants, products, vendors } from "../../database/schema.js";
import {
  bundleAgreement,
  bundleAnswerProblem,
  bundleChangeNeedsAsking,
  isSellableBundle,
  chargedTotal,
  savingOf,
  separatelyTotal,
  splitBundlePrice,
  type Bundle,
} from "../../../Shared/commerce/bundles.js";
import { multiplyMoney } from "../../../Shared/money.js";
import { discountAllowed } from "../../../Shared/inventory/discountLicence.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { recordAudit } from "./audit.js";
import { getDb } from "./db.js";
import { auditActor } from "./inventory.js";
import { notifyStore } from "./notifications.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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
  /** The store that made it, by name; null for NetLet's own. */
  ownerName: string | null;
  /** Its Arabic name, when it has one; the page picks by language. */
  ownerNameAr: string | null;
  /**
   * Where a set made with other stores' products stands (3.3.11, by
   * arrangement): each store asked and its answer. Empty for a store's own set
   * and for NetLet's.
   */
  agreement: {
    asked: { vendorId: number; vendorName: string | null; vendorNameAr: string | null; state: "waiting" | "agreed" | "declined"; note: string | null; decidedAt: string | null }[];
    agreed: boolean;
    declined: boolean;
  };
  separately: string;
  saving: string;
  crossVendor: boolean;
  members: (Bundle["members"][number] & {
    productHandle: string;
    productTitle: string;
    /** The product's and its store's Arabic names, when they have them. */
    productTitleAr: string | null;
    variantTitle: string | null;
    vendorName: string | null;
    vendorNameAr: string | null;
    availableForSale: boolean;
    /** What one of these costs inside the set, and what the line comes to. */
    bundleUnitPrice: string;
    lineTotal: string;
  })[];
};

/* ------------------------------------------------ sets made by arrangement --- */

let agreementsPresent = false;
let agreementsCheckedAt = 0;

/**
 * Whether `bundle_agreements` exists (migration 0091). Until it is pasted a
 * set made with another store's products cannot be agreed to, so it is not
 * made and none is on sale; everything else about bundles works as before.
 */
export async function bundleAgreementsReady(db: Db | Tx): Promise<boolean> {
  if (agreementsPresent) return true;
  if (agreementsCheckedAt !== 0 && Date.now() - agreementsCheckedAt < 60_000) return false;
  const result = await db.execute<{ ready: boolean }>(sql`select to_regclass('public.bundle_agreements') is not null as ready`);
  const rows = Array.isArray(result) ? result : (result as { rows: { ready: boolean }[] }).rows;
  agreementsPresent = Boolean(rows[0]?.ready);
  agreementsCheckedAt = Date.now();
  return agreementsPresent;
}

/** For tests that rename the table away and back. */
export function forgetBundleAgreementReadiness(): void {
  agreementsPresent = false;
  agreementsCheckedAt = 0;
}

type Answer = { bundleId: number; vendorId: number; state: "agreed" | "declined"; note: string | null; decidedAt: Date };

async function answersFor(db: Db | Tx, bundleIds: number[]): Promise<Answer[]> {
  if (bundleIds.length === 0 || !(await bundleAgreementsReady(db))) return [];
  const rows = await db
    .select({
      bundleId: bundleAgreements.bundleId,
      vendorId: bundleAgreements.vendorId,
      state: bundleAgreements.state,
      note: bundleAgreements.note,
      decidedAt: bundleAgreements.decidedAt,
    })
    .from(bundleAgreements)
    .where(inArray(bundleAgreements.bundleId, bundleIds));
  return rows.map(row => ({ ...row, state: row.state === "declined" ? "declined" : "agreed" }));
}

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
      ownerName: vendors.name,
      ownerNameAr: vendors.nameAr,
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
      productTitleAr: products.titleAr,
      productStatus: products.status,
      vendorId: vendors.id,
      vendorName: vendors.name,
      vendorNameAr: vendors.nameAr,
      vendorStatus: vendors.status,
      licenceNumber: vendors.discountLicenceNumber,
      licenceExpiresAt: vendors.discountLicenceExpiresAt,
    })
    .from(bundleItems)
    .innerJoin(productVariants, eq(productVariants.id, bundleItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(inArray(bundleItems.bundleId, rows.map(row => row.bundle.id)))
    .orderBy(asc(bundleItems.position), asc(bundleItems.id));

  const answers = await answersFor(db, rows.filter(row => row.bundle.vendorId !== null).map(row => row.bundle.id));

  const views: BundleView[] = [];
  for (const row of rows) {
    const mine = members.filter(member => member.bundleId === row.bundle.id);
    const given = answers.filter(answer => answer.bundleId === row.bundle.id);
    const standing = bundleAgreement(row.bundle.vendorId, mine, given);

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
       * The permit. A store's set is an advertised saving by every store that
       * gives up a share of its price in it, so each needs its own valid
       * permit — the owner's for its own set, every store's in a set made by
       * arrangement. NetLet's own (`vendorId` null) is the platform's
       * promotion, the same distinction the discount codes make, and it
       * carries no store's permit to check.
       */
      if (row.bundle.vendorId !== null) {
        const permitted = mine.every(member =>
          discountAllowed({ number: member.licenceNumber, expiresAt: member.licenceExpiresAt }).allowed,
        );
        if (!permitted) continue;
        /* By arrangement: on sale only once every store asked has agreed. */
        if (!standing.agreed) continue;
      }
    }

    const view: BundleView = {
      id: row.bundle.id,
      name: row.bundle.name,
      nameAr: row.bundle.nameAr,
      vendorId: row.bundle.vendorId,
      bundlePrice: row.bundle.bundlePrice,
      active: row.bundle.active,
      ownerName: row.bundle.vendorId === null ? null : row.ownerName,
      ownerNameAr: row.bundle.vendorId === null ? null : row.ownerNameAr,
      agreement: {
        asked: standing.asked.map(entry => {
          const answer = given.find(item => item.vendorId === entry.vendorId);
          return {
            vendorId: entry.vendorId,
            vendorName: mine.find(member => member.vendorId === entry.vendorId)?.vendorName ?? null,
            vendorNameAr: mine.find(member => member.vendorId === entry.vendorId)?.vendorNameAr ?? null,
            state: entry.state,
            note: entry.state === "waiting" ? null : answer?.note ?? null,
            decidedAt: entry.state === "waiting" || !answer ? null : answer.decidedAt.toISOString(),
          };
        }),
        agreed: standing.agreed,
        declined: standing.declined,
      },
      members: mine.map(member => ({
        variantId: member.variantId,
        vendorId: member.vendorId,
        quantity: member.quantity,
        unitPrice: member.unitPrice,
        productHandle: member.productHandle,
        productTitle: member.productTitle,
        productTitleAr: member.productTitleAr,
        variantTitle: member.variantTitle,
        vendorName: member.vendorName,
        vendorNameAr: member.vendorNameAr,
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
    /* A set made by arrangement saves nothing until every store in it has
       agreed: a line carrying its id is priced as its own product. */
    if (!bundle.agreement.agreed) continue;
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
 * A store may bundle its own goods, and **other stores' goods by
 * arrangement** (3.3.11, on the owner's word): a set holding another store's
 * product is made at once and is on sale only once every other store in it
 * has agreed (`answerBundle`), because a store that could put another shop's
 * product into a discounted set would otherwise be spending money that is not
 * its own. It must hold something of the owner's own — arranging two other
 * stores' goods is NetLet's merchandising, `bundles.netlet`. A change to the
 * price or the items takes back every answer, so nobody is held to a set they
 * did not see; a new name does not.
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

  if (input.vendorId === null) assertCan(actor, "bundles.netlet");
  else assertCan(actor, "product.edit", input.vendorId);

  /*
   * An edit is checked against the bundle as it stands, not only against the
   * store the request names. It was checked against the request alone, so a
   * seller who sent another store's bundle id — or one of NetLet's own — with
   * their own store on it rewrote that bundle into theirs: its name, its price
   * and every item in it.
   */
  let before: { bundlePrice: string; members: { variantId: number; quantity: number }[] } | null = null;
  if (input.id) {
    const [current] = await db
      .select({ vendorId: bundles.vendorId, bundlePrice: bundles.bundlePrice })
      .from(bundles)
      .where(eq(bundles.id, input.id))
      .limit(1);
    if (!current) throw new BundleError("bundle.unknown");
    if (current.vendorId === null) assertCan(actor, "bundles.netlet");
    else assertCan(actor, "product.edit", current.vendorId);
    const items = await db
      .select({ variantId: bundleItems.variantId, quantity: bundleItems.quantity })
      .from(bundleItems)
      .where(eq(bundleItems.bundleId, input.id));
    before = { bundlePrice: current.bundlePrice, members: items };
  }

  if (input.members.length < 2) throw new BundleError("bundle.tooFew");

  /* Where every member actually comes from, read rather than trusted. */
  const owners = await db
    .select({
      variantId: productVariants.id,
      vendorId: products.vendorId,
      price: productVariants.price,
      vendorStatus: vendors.status,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(inArray(productVariants.id, input.members.map(member => member.variantId)));

  if (owners.length !== input.members.length) throw new BundleError("bundle.unknownItem");

  const others = input.vendorId === null ? [] : owners.filter(owner => owner.vendorId !== input.vendorId);
  if (others.length > 0) {
    /* By arrangement: the other stores are asked before anything is sold, so
       the set waits for the table that holds their answers. */
    if (!(await bundleAgreementsReady(db))) throw new BundleError("bundle.arrangementUnavailable");
    /* Something of the owner's own, or this is two other shops' set. */
    if (others.length === owners.length) throw new BundleError("bundle.needsYours");
    /* A store that cannot sell cannot agree. */
    if (others.some(owner => owner.vendorStatus !== "approved")) throw new BundleError("bundle.storeUnavailable");
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
  const members = input.members.map(member => ({ variantId: member.variantId, quantity: Math.max(1, Math.trunc(member.quantity)) }));
  const askAgain = before === null || bundleChangeNeedsAsking(before, { bundlePrice: input.bundlePrice, members });

  const saved = await db.transaction(async tx => {
    const id = input.id
      ? (await tx.update(bundles).set(values).where(eq(bundles.id, input.id)).returning({ id: bundles.id }))[0]?.id
      : (await tx.insert(bundles).values(values).returning({ id: bundles.id }))[0].id;
    if (!id) throw new BundleError("bundle.unknown");

    /* The whole list at once, like the product images: a bundle is read as a set
       and a per-row endpoint turns reordering two of them into four calls. */
    await tx.delete(bundleItems).where(eq(bundleItems.bundleId, id));
    await tx.insert(bundleItems).values(
      members.map((member, position) => ({ bundleId: id, variantId: member.variantId, quantity: member.quantity, position })),
    );
    /* A new price or new items is a new set: every answer given about the old
       one goes, in the same transaction, so the set is never on sale on an
       agreement to something else. */
    if (askAgain && input.id && (await bundleAgreementsReady(tx))) {
      await tx.delete(bundleAgreements).where(eq(bundleAgreements.bundleId, id));
    }
    return { id };
  });

  /* Each store asked hears of it once per version of the set: the price and
     the items are in the key, so saving an unchanged set again tells nobody. */
  if (askAgain && input.vendorId !== null && others.length > 0) {
    const version = [input.bundlePrice, ...members.map(member => `${member.variantId}x${member.quantity}`).sort()].join(",");
    const ownerName = (await db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, input.vendorId)).limit(1))[0]?.name ?? "";
    for (const vendorId of new Set(others.map(owner => owner.vendorId))) {
      await notifyStore(vendorId, {
        kind: "seller_bundle_asked",
        params: { bundle: values.name, store: ownerName },
        link: "/admin/bundles",
        dedupe: `bundle:asked:${saved.id}:${vendorId}:${version}`,
      });
    }
  }
  return saved;
}

/**
 * The sets other stores have made with this store's products (3.3.11): what
 * it has been asked about, each with where its own answer stands. Scoped in
 * the query to the actor's own store.
 */
export async function listAskedBundles(actor: Actor): Promise<(BundleView & { myState: "waiting" | "agreed" | "declined" })[]> {
  const db = await getDb();
  if (!db || actor.kind !== "vendor") return [];
  assertCan(actor, "product.view", actor.vendorId);
  if (!(await bundleAgreementsReady(db))) return [];
  const rows = await db
    .selectDistinct({ bundleId: bundleItems.bundleId })
    .from(bundleItems)
    .innerJoin(bundles, eq(bundles.id, bundleItems.bundleId))
    .innerJoin(productVariants, eq(productVariants.id, bundleItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(products.vendorId, actor.vendorId), isNotNull(bundles.vendorId), ne(bundles.vendorId, actor.vendorId)));
  if (rows.length === 0) return [];
  const views = await loadBundles(db, { ids: rows.map(row => row.bundleId) });
  return views.map(view => ({
    ...view,
    myState: view.agreement.asked.find(entry => entry.vendorId === actor.vendorId)?.state ?? "waiting",
  }));
}

/** How many sets are waiting on this store's answer, for the overview. */
export async function bundlesAwaitingAnswer(actor: Actor): Promise<number> {
  if (actor.kind !== "vendor") return 0;
  return (await listAskedBundles(actor)).filter(view => view.myState === "waiting").length;
}

/**
 * A store's answer to a set another store made with its products. Agreeing
 * is giving up a share of its own price inside that set, so it is a manager's
 * act on the store's catalogue (`product.edit`) and on the trail; declining
 * needs words the owner reads. Answering again changes the answer.
 */
export async function answerBundle(
  actor: Actor,
  input: { bundleId: number; state: "agreed" | "declined"; note?: string | null },
): Promise<{ agreed: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  if (actor.kind !== "vendor") throw new BundleError("bundle.notAsked");
  assertCan(actor, "product.edit", actor.vendorId);
  if (!(await bundleAgreementsReady(db))) throw new BundleError("bundle.arrangementUnavailable");
  const problem = bundleAnswerProblem(input.state, input.note);
  if (problem) throw new BundleError(problem);

  const [view] = await loadBundles(db, { ids: [input.bundleId] });
  if (!view) throw new BundleError("bundle.unknown");
  /* Asked means another store's set holding this store's product, as the set
     stands now; anything else is a set this store has no say in. */
  if (!view.agreement.asked.some(entry => entry.vendorId === actor.vendorId)) throw new BundleError("bundle.notAsked");

  const note = input.note?.trim() || null;
  const now = new Date();
  await db
    .insert(bundleAgreements)
    .values({ bundleId: view.id, vendorId: actor.vendorId, state: input.state, note, decidedBy: actor.userId, decidedAt: now })
    .onConflictDoUpdate({
      target: [bundleAgreements.bundleId, bundleAgreements.vendorId],
      set: { state: input.state, note, decidedBy: actor.userId, decidedAt: now },
    });

  const mine = view.agreement.asked.find(entry => entry.vendorId === actor.vendorId);
  const myName = mine?.vendorName ?? "";
  await recordAudit(await auditActor(actor), {
    action: input.state === "agreed" ? "bundle.agree" : "bundle.decline",
    subjectType: "bundle",
    subjectId: view.id,
    subjectLabel: view.name,
    vendorId: actor.vendorId,
    before: { state: mine?.state ?? "waiting" },
    after: { state: input.state, note, bundlePrice: view.bundlePrice, owner: view.vendorId },
  });

  const others = view.agreement.asked.filter(entry => entry.vendorId !== actor.vendorId);
  const agreed = input.state === "agreed" && others.every(entry => entry.state === "agreed");
  if (view.vendorId !== null) {
    await notifyStore(view.vendorId, {
      kind: input.state === "agreed" ? "seller_bundle_agreed" : "seller_bundle_declined",
      params: { bundle: view.name, store: myName, note: note ?? "" },
      link: "/admin/bundles",
      dedupe: `bundle:answer:${view.id}:${actor.vendorId}:${now.getTime()}`,
    });
  }
  return { agreed };
}

/** Every bundle the caller may see, for the portal's list. */
export async function listBundles(actor: Actor): Promise<BundleView[]> {
  const db = await getDb();
  if (!db) return [];
  /* Reading the bundles is reading the catalogue (`product.view`), the
     page's own gate; making or changing NetLet's own is `bundles.netlet`.
     Asking that here refused every team role whose menu offers the page
     without the Catalogue area — Finance, Operations, Marketing. */
  if (actor.kind === "admin") {
    assertCan(actor, "product.view");
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

  if (row.vendorId === null) assertCan(actor, "bundles.netlet");
  else assertCan(actor, "product.edit", row.vendorId);

  await db.update(bundles).set({ active }).where(eq(bundles.id, bundleId));
}
