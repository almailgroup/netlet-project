/**
 * The occasions NetLet curates by hand — the database half of
 * `Shared/commerce/occasionDesk.ts` (migration 0081).
 *
 * Two public reads and a desk. `liveOccasions` is what the home page asks:
 * NetLet's occasions that are published and running today, each with the
 * products chosen for it, and the calendar occasions the calendar must not
 * draw by itself. `occasionBySlug` is an occasion's own page, which answers
 * for any published one, in or out of its days, so a link somebody shared
 * does not go dead when the season ends. Both draw products through
 * `listProductsByIds`, so an occasion cannot show what the shop would not —
 * a draft, an archived product, a suspended store's.
 *
 * The desk is NetLet's (`platform.configure`), since an occasion is NetLet's
 * own front page. Every save is held to `occasionProblems`, whatever the form
 * said; publishing, taking down, switching a calendar occasion off and
 * deleting are on the trail.
 *
 * **Closed, not broken, before 0081 is pasted**: the code deploys first, so a
 * missing table reads as "nothing curated" — the home page is the calendar's
 * as it was — and the desk says it is not open yet.
 */
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { mediaFiles, occasionProducts, occasions, productImages, products, vendors } from "../../database/schema.js";
import { translate } from "../../../Shared/i18n/dictionary.js";
import {
  MAX_CURATED_OCCASIONS,
  MAX_LIVE_OCCASIONS,
  MAX_OCCASION_PRODUCTS,
  curatedKeys,
  curatedOn,
  firstOccasionProblem,
  isCalendarSlug,
  occasionProblems,
  occasionSeason,
  replacedSlugs,
  statusAllowed,
  type CuratedOccasion,
  type OccasionContent,
  type OccasionSeason,
  type OccasionStatus,
  type PublicOccasion,
} from "../../../Shared/commerce/occasionDesk.js";
import { OCCASIONS, foldTag, occasionFromSlug, occasionKeys, occasionOn } from "../../../Shared/commerce/occasions.js";
import { mediaIdOf } from "../../../Shared/commerce/media.js";
import type { LocalePick } from "../../../Shared/commerce/fromInventory.js";
import type { Product } from "../../../Shared/commerce/types.js";
import type { MessageKey } from "../../../Shared/i18n/dictionary.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { isMissingTable } from "../core/describeError.js";
import { recordAudit } from "./audit.js";
import { listProductsByIds } from "./catalog.js";
import { getDb } from "./db.js";
import { auditActor } from "./inventory.js";

export type OccasionRefusal =
  | MessageKey
  | "occasions.notFound"
  | "occasions.unavailable"
  | "occasions.slugTaken"
  | "occasions.tooMany"
  | "occasions.tooManyProducts"
  | "occasions.noSuchProduct"
  | "occasions.cannotHide";

export class OccasionRefused extends Error {
  constructor(readonly reason: OccasionRefusal, readonly field?: string) {
    super(reason);
    this.name = "OccasionRefused";
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Row = typeof occasions.$inferSelect;

function asPublic(row: Row): PublicOccasion {
  return { slug: row.slug, title: row.title, titleAr: row.titleAr, imageUrl: row.imageUrl, includeTagged: row.includeTagged };
}

function asCurated(row: Row): CuratedOccasion {
  return { ...asPublic(row), startsOn: row.startsOn, endsOn: row.endsOn, status: row.status };
}

/** The chosen products of some occasions, each in its own order. */
async function chosenIds(db: Db, occasionIds: number[]): Promise<Map<number, number[]>> {
  const byOccasion = new Map<number, number[]>();
  if (occasionIds.length === 0) return byOccasion;
  const rows = await db
    .select({ occasionId: occasionProducts.occasionId, productId: occasionProducts.productId })
    .from(occasionProducts)
    .where(inArray(occasionProducts.occasionId, occasionIds))
    /* Ends on the product: positions tie when a save writes them, and a tie is ordered freely. */
    .orderBy(asc(occasionProducts.occasionId), asc(occasionProducts.position), asc(occasionProducts.productId));
  for (const row of rows) {
    const list = byOccasion.get(row.occasionId) ?? [];
    list.push(row.productId);
    byOccasion.set(row.occasionId, list);
  }
  return byOccasion;
}

/* ------------------------------------------------------------ public --- */

export type LiveOccasions = {
  /** False while the tables are not there yet: the home page is the calendar's own. */
  ready: boolean;
  /** NetLet's occasions running today, the one that started last first, each with the products chosen for it. */
  occasions: (PublicOccasion & { products: Product[] })[];
  /** Calendar occasions the calendar must not draw by itself: taken over, or switched off. */
  replaced: string[];
};

const NOTHING_LIVE: LiveOccasions = { ready: false, occasions: [], replaced: [] };

/** What the home page draws of NetLet's own today. */
export async function liveOccasions(locale: LocalePick = "en", now = new Date()): Promise<LiveOccasions> {
  const db = await getDb();
  if (!db) return NOTHING_LIVE;
  try {
    const rows = await db
      .select()
      .from(occasions)
      .where(ne(occasions.status, "draft"))
      /* The one that started last leads; one that keeps the calendar's days follows those with days of their own. */
      .orderBy(sql`${occasions.startsOn} desc nulls last`, desc(occasions.id))
      .limit(MAX_CURATED_OCCASIONS);
    const on = curatedOn(rows.map(row => ({ ...asCurated(row), id: row.id })), now).slice(0, MAX_LIVE_OCCASIONS);
    const ids = await chosenIds(db, on.map(row => row.id));
    const every = [...new Set([...ids.values()].flat())];
    const shown = new Map((await listProductsByIds(every, locale)).map(product => [product.id, product]));
    return {
      ready: true,
      occasions: on.map(row => ({
        slug: row.slug,
        title: row.title,
        titleAr: row.titleAr,
        imageUrl: row.imageUrl,
        includeTagged: row.includeTagged,
        products: (ids.get(row.id) ?? []).flatMap(id => {
          const product = shown.get(String(id));
          return product ? [product] : [];
        }),
      })),
      replaced: replacedSlugs(rows),
    };
  } catch (error) {
    if (isMissingTable(error)) return NOTHING_LIVE;
    throw error;
  }
}

export type OccasionPage = {
  /** NetLet's published occasion at this address, or null: the calendar's own rule then decides. */
  occasion: PublicOccasion | null;
  /** A calendar occasion NetLet switched off: its page shows nothing. */
  hidden: boolean;
  /** The products chosen for it, in order, that the shop shows. */
  products: Product[];
};

/** One occasion's page. A draft is the same answer as an address nobody wrote. */
export async function occasionBySlug(slug: string, locale: LocalePick = "en"): Promise<OccasionPage> {
  const nothing: OccasionPage = { occasion: null, hidden: false, products: [] };
  const db = await getDb();
  if (!db) return nothing;
  try {
    const [row] = await db.select().from(occasions).where(and(eq(occasions.slug, slug), ne(occasions.status, "draft"))).limit(1);
    if (!row) return nothing;
    if (row.status === "hidden") return { occasion: null, hidden: true, products: [] };
    const ids = (await chosenIds(db, [row.id])).get(row.id) ?? [];
    return { occasion: asPublic(row), hidden: false, products: await listProductsByIds(ids, locale) };
  } catch (error) {
    if (isMissingTable(error)) return nothing;
    throw error;
  }
}

/* -------------------------------------------------------------- desk --- */

/** One of NetLet's occasions as the desk lists it. */
export type AdminOccasion = CuratedOccasion & {
  id: number;
  /** Its address is a calendar occasion's, which it takes over once published. */
  calendar: boolean;
  season: OccasionSeason;
  /** Products chosen for it. */
  chosen: number;
  /** Of those, how many the shop shows today. */
  live: number;
  /** Products the stores tagged for it that the shop shows, beyond the chosen. */
  tagged: number;
  updatedAt: Date;
};

/** One of the calendar's own occasions as the desk lists it. */
export type CalendarEntry = {
  slug: string;
  /** Whether the calendar's window is open today. */
  on: boolean;
  /** Products the stores tagged for it that the shop shows. */
  tagged: number;
  /** NetLet's row for it, if it has one. */
  row: { id: number; status: OccasionStatus } | null;
};

export type OccasionDesk = { ready: boolean; rows: AdminOccasion[]; calendar: CalendarEntry[] };

/** A product chosen for an occasion, as the editor lists it. */
export type ChosenProduct = {
  id: number;
  title: string;
  titleAr: string | null;
  vendorName: string | null;
  imageUrl: string | null;
  /** Whether the shop shows it today: published, from an approved store. */
  live: boolean;
};

export type OccasionDetail = AdminOccasion & { products: ChosenProduct[] };

/** Every product the shop shows that carries a tag, with its tags folded once. */
async function taggedShelf(db: Db): Promise<{ id: number; tags: Set<string> }[]> {
  const rows = await db
    .select({ id: products.id, tags: products.tags })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(eq(products.status, "published"), eq(vendors.status, "approved"), sql`cardinality(${products.tags}) > 0`));
  return rows.map(row => ({ id: row.id, tags: new Set(row.tags.map(foldTag)) }));
}

function countTagged(shelf: { id: number; tags: Set<string> }[], keys: Set<string>, except: Set<number> = new Set()): number {
  let count = 0;
  for (const product of shelf) {
    if (except.has(product.id)) continue;
    for (const key of keys) {
      if (product.tags.has(key)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/** Which of some products the shop shows today. */
async function liveAmong(db: Db, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(inArray(products.id, ids), eq(products.status, "published"), eq(vendors.status, "approved")));
  return new Set(rows.map(row => row.id));
}

type TaggedShelf = Awaited<ReturnType<typeof taggedShelf>>;

async function describe(db: Db, rows: Row[], now: Date, tagged?: TaggedShelf): Promise<AdminOccasion[]> {
  const [ids, shelf] = await Promise.all([chosenIds(db, rows.map(row => row.id)), tagged ?? taggedShelf(db)]);
  const live = await liveAmong(db, [...new Set([...ids.values()].flat())]);
  return rows.map(row => {
    const chosen = ids.get(row.id) ?? [];
    return {
      ...asCurated(row),
      id: row.id,
      calendar: isCalendarSlug(row.slug),
      season: occasionSeason(row, now),
      chosen: chosen.length,
      live: chosen.filter(id => live.has(id)).length,
      tagged: countTagged(shelf, curatedKeys(row), new Set(chosen)),
      updatedAt: row.updatedAt,
    };
  });
}

/** NetLet's occasions, the newest change first, and the calendar's ten with what stands over each. */
export async function listOccasions(actor: Actor, now = new Date()): Promise<OccasionDesk> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) return { ready: false, rows: [], calendar: [] };
  try {
    const rows = await db.select().from(occasions).orderBy(desc(occasions.updatedAt), desc(occasions.id)).limit(MAX_CURATED_OCCASIONS);
    const shelf = await taggedShelf(db);
    const described = await describe(db, rows, now, shelf);
    const bySlug = new Map(rows.map(row => [row.slug, row]));
    return {
      ready: true,
      rows: described,
      calendar: OCCASIONS.map(occasion => {
        const row = bySlug.get(occasion.slug);
        return {
          slug: occasion.slug,
          on: occasionOn(occasion, now),
          tagged: countTagged(shelf, occasionKeys(occasion)),
          row: row ? { id: row.id, status: row.status } : null,
        };
      }),
    };
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, rows: [], calendar: [] };
    throw error;
  }
}

async function rowById(db: Db, id: number): Promise<Row> {
  const [row] = await db.select().from(occasions).where(eq(occasions.id, id)).limit(1);
  if (!row) throw new OccasionRefused("occasions.notFound");
  return row;
}

async function detailOf(db: Db, row: Row, now: Date): Promise<OccasionDetail> {
  const [described] = await describe(db, [row], now);
  const ids = (await chosenIds(db, [row.id])).get(row.id) ?? [];
  if (ids.length === 0) return { ...described, products: [] };
  const [found, live, photos] = await Promise.all([
    db
      .select({ id: products.id, title: products.title, titleAr: products.titleAr, vendorName: vendors.name })
      .from(products)
      .leftJoin(vendors, eq(products.vendorId, vendors.id))
      .where(inArray(products.id, ids)),
    liveAmong(db, ids),
    db
      .select({ productId: productImages.productId, url: productImages.url })
      .from(productImages)
      .where(and(inArray(productImages.productId, ids), eq(productImages.kind, "image")))
      .orderBy(asc(productImages.productId), asc(productImages.position), asc(productImages.id)),
  ]);
  const byId = new Map(found.map(product => [product.id, product]));
  const firstPhoto = new Map<number, string>();
  for (const photo of photos) if (!firstPhoto.has(photo.productId)) firstPhoto.set(photo.productId, photo.url);
  return {
    ...described,
    products: ids.flatMap(id => {
      const product = byId.get(id);
      return product
        ? [{ id, title: product.title, titleAr: product.titleAr, vendorName: product.vendorName, imageUrl: firstPhoto.get(id) ?? null, live: live.has(id) }]
        : [];
    }),
  };
}

export async function getOccasion(actor: Actor, id: number, now = new Date()): Promise<OccasionDetail> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) throw new OccasionRefused("occasions.unavailable");
  try {
    return await detailOf(db, await rowById(db, id), now);
  } catch (error) {
    if (isMissingTable(error)) throw new OccasionRefused("occasions.unavailable");
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  for (let step: unknown = error, depth = 0; step && depth < 6; depth++) {
    if ((step as { code?: unknown }).code === "23505") return true;
    step = (step as { cause?: unknown }).cause;
  }
  return false;
}

export type OccasionDraft = OccasionContent & { productIds: number[] };

/** The content as it is stored: trimmed, an empty day as none. */
function cleaned(content: OccasionContent): OccasionContent {
  return {
    slug: content.slug.trim().toLowerCase(),
    title: content.title.trim(),
    titleAr: content.titleAr.trim(),
    imageUrl: content.imageUrl || null,
    startsOn: content.startsOn || null,
    endsOn: content.endsOn || null,
    includeTagged: content.includeTagged,
  };
}

/**
 * Write an occasion and the products chosen for it, in one transaction. A new
 * one starts as a draft. A published one keeps its address, since the address
 * is what a shared link holds; a draft's can change.
 */
export async function saveOccasion(actor: Actor, id: number | null, draft: OccasionDraft, now = new Date()): Promise<OccasionDetail> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) throw new OccasionRefused("occasions.unavailable");
  const content = cleaned(draft);
  const productIds = [...new Set(draft.productIds)];
  if (productIds.length > MAX_OCCASION_PRODUCTS) throw new OccasionRefused("occasions.tooManyProducts");
  try {
    const current = id === null ? null : await rowById(db, id);
    /* The address of one already public stands, whatever the form sent. */
    if (current && current.status !== "draft") content.slug = current.slug;
    const problem = firstOccasionProblem(occasionProblems(content));
    if (problem) throw new OccasionRefused(problem.problem, problem.field);
    if (content.imageUrl && content.imageUrl !== current?.imageUrl) {
      const [file] = await db.select({ id: mediaFiles.id }).from(mediaFiles).where(eq(mediaFiles.id, mediaIdOf(content.imageUrl))).limit(1);
      if (!file) throw new OccasionRefused("occasions.badPicture", "imageUrl");
    }
    if (productIds.length > 0) {
      const found = await db.select({ id: products.id }).from(products).where(inArray(products.id, productIds));
      if (found.length !== productIds.length) throw new OccasionRefused("occasions.noSuchProduct");
    }
    const row = await db.transaction(async tx => {
      let saved: Row;
      if (current) {
        [saved] = await tx.update(occasions).set({ ...content, updatedAt: now }).where(eq(occasions.id, current.id)).returning();
        if (!saved) throw new OccasionRefused("occasions.notFound");
      } else {
        const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(occasions);
        if (total >= MAX_CURATED_OCCASIONS) throw new OccasionRefused("occasions.tooMany");
        [saved] = await tx.insert(occasions).values({ ...content, status: "draft", createdBy: actor.userId }).returning();
      }
      await tx.delete(occasionProducts).where(eq(occasionProducts.occasionId, saved.id));
      if (productIds.length > 0) {
        await tx.insert(occasionProducts).values(productIds.map((productId, position) => ({ occasionId: saved.id, productId, position })));
      }
      return saved;
    });
    return await detailOf(db, row, now);
  } catch (error) {
    if (error instanceof OccasionRefused) throw error;
    if (isMissingTable(error)) throw new OccasionRefused("occasions.unavailable");
    if (isUniqueViolation(error)) throw new OccasionRefused("occasions.slugTaken", "slug");
    throw error;
  }
}

/** Publish, take down, or switch a calendar occasion off. Asks the rule again, whatever the page said. */
export async function setOccasionStatus(actor: Actor, id: number, status: OccasionStatus, now = new Date()): Promise<OccasionDetail> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) throw new OccasionRefused("occasions.unavailable");
  try {
    const current = await rowById(db, id);
    if (!statusAllowed(current.slug, status)) throw new OccasionRefused("occasions.cannotHide");
    if (status === "published") {
      const problem = firstOccasionProblem(occasionProblems(asCurated(current)));
      if (problem) throw new OccasionRefused(problem.problem, problem.field);
    }
    if (current.status === status) return await detailOf(db, current, now);
    const [row] = await db.update(occasions).set({ status, updatedAt: now }).where(eq(occasions.id, id)).returning();
    if (!row) throw new OccasionRefused("occasions.notFound");
    await recordAudit(await auditActor(actor), {
      action: "occasion.setStatus",
      subjectType: "occasion",
      subjectId: id,
      subjectLabel: current.title,
      before: { status: current.status },
      after: { status },
    });
    return await detailOf(db, row, now);
  } catch (error) {
    if (error instanceof OccasionRefused) throw error;
    if (isMissingTable(error)) throw new OccasionRefused("occasions.unavailable");
    throw error;
  }
}

/**
 * Switch one of the calendar's occasions off. With no row for it yet, one is
 * made under the calendar's own names, so switching it back on is a press on
 * a row that exists.
 */
export async function hideCalendarOccasion(actor: Actor, slug: string, now = new Date()): Promise<OccasionDetail> {
  assertCan(actor, "platform.configure");
  const calendar = occasionFromSlug(slug);
  if (!calendar) throw new OccasionRefused("occasions.cannotHide");
  const db = await getDb();
  if (!db) throw new OccasionRefused("occasions.unavailable");
  try {
    const [existing] = await db.select().from(occasions).where(eq(occasions.slug, slug)).limit(1);
    if (existing) return await setOccasionStatus(actor, existing.id, "hidden", now);
    const [row] = await db
      .insert(occasions)
      .values({
        slug,
        title: translate("en", calendar.label),
        titleAr: translate("ar", calendar.label),
        includeTagged: true,
        status: "hidden",
        createdBy: actor.userId,
      })
      .returning();
    await recordAudit(await auditActor(actor), {
      action: "occasion.setStatus",
      subjectType: "occasion",
      subjectId: row.id,
      subjectLabel: row.title,
      before: { status: null },
      after: { status: "hidden" },
    });
    return await detailOf(db, row, now);
  } catch (error) {
    if (error instanceof OccasionRefused) throw error;
    if (isMissingTable(error)) throw new OccasionRefused("occasions.unavailable");
    /* Two presses at once: the other made the row, so this one hides it. */
    if (isUniqueViolation(error)) {
      const [existing] = await db.select().from(occasions).where(eq(occasions.slug, slug)).limit(1);
      if (existing) return setOccasionStatus(actor, existing.id, "hidden", now);
    }
    throw error;
  }
}

/** Delete one for good. A calendar occasion goes back to the calendar's own. */
export async function deleteOccasion(actor: Actor, id: number): Promise<void> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) throw new OccasionRefused("occasions.unavailable");
  try {
    const [gone] = await db.delete(occasions).where(eq(occasions.id, id)).returning({ title: occasions.title, status: occasions.status, slug: occasions.slug });
    if (!gone) throw new OccasionRefused("occasions.notFound");
    await recordAudit(await auditActor(actor), {
      action: "occasion.delete",
      subjectType: "occasion",
      subjectId: id,
      subjectLabel: gone.title,
      before: { status: gone.status, slug: gone.slug },
    });
  } catch (error) {
    if (error instanceof OccasionRefused) throw error;
    if (isMissingTable(error)) throw new OccasionRefused("occasions.unavailable");
    throw error;
  }
}
