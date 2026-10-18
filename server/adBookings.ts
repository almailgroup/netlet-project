/**
 * Self-service placements (3.3.15), the database half. The rules are in
 * `Shared/commerce/adBookings.ts`; the fee is taken by `server/payoutRuns.ts`.
 *
 * Outside `db.ts` for the reason `orders.ts` and `payoutRuns.ts` are: a
 * function inside it calls that file's module-local `getDb`, which nothing
 * outside can redirect, so it could not be tested against a real Postgres.
 *
 * **Two races, two locks.** A place holds so many products a day, and two
 * sellers pressing Book for the last one at once would each count the same
 * free place — so every booking takes one transaction-scoped advisory lock
 * before it counts, and bookings serialise. Bookings are rare and short; one
 * lock for all of them is the simple answer and the right one. And a seller
 * books against what they have earned, so two of their own bookings at once
 * could spend the same earnings twice — so the store's row is locked `for
 * update`, the lock a payout run takes, and a run recorded between the two
 * is counted too.
 *
 * **Scoped in the query.** A store sees and cancels its own bookings; an
 * administrator sees every store's and may take any down. Another store's
 * booking is "not found", never "forbidden" — the answer does not confirm it
 * exists.
 */
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { adBookings, categories, mediaFiles, payoutRunItems, products, vendors } from "../drizzle/schema.js";
import {
  AD_CAPACITY,
  AD_RATES,
  addDays,
  approvalStart,
  bannerShapeOk,
  bookingProblem,
  daysInclusive,
  headlineProblem,
  type BannerProblem,
  type BannerStatus,
  bookingState,
  cancellable,
  feeAccrued,
  fullDays,
  kuwaitToday,
  quoteFor,
  type AdSlot,
  type BookingProblem,
  type BookingState,
} from "../Shared/commerce/adBookings.js";
import { contactFindings } from "../Shared/commerce/contactFilter.js";
import { mediaPath, type StoredType } from "../Shared/commerce/media.js";
import { discountAllowed } from "../Shared/inventory/discountLicence.js";
import { assertCan, type Actor } from "../Shared/inventory/permissions.js";
import { fromFils, toFils } from "../Shared/money.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../Shared/pagination.js";
import type { LocalePick } from "../Shared/commerce/fromInventory.js";
import type { Product } from "../Shared/commerce/types.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { listProductsByIds } from "./catalog.js";
import { placementRoom } from "./payoutRuns.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** One key for every booking: see the note on races above. */
const BOOKING_LOCK = 3_315;

export type AdRefusal =
  | BookingProblem
  | "ads.notYours"
  | "ads.productUnavailable"
  | "ads.noDepartment"
  | "ads.full"
  | "ads.notEnoughEarned"
  | "ads.notFound"
  | "ads.notCancellable"
  | BannerProblem
  | "ads.bannerNeedsImage"
  | "ads.bannerShape"
  | "ads.bannerNotWaiting"
  | "ads.bannerLapsed"
  | "ads.bannerNeedsNote";

export class AdRefused extends Error {
  constructor(readonly reason: AdRefusal, readonly days: string[] = []) {
    super(reason);
    this.name = "AdRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/** Only a store books: an administrator has no earnings for the fee to come off. */
function storeOf(actor: Actor): number {
  if (actor.kind !== "vendor") throw new AdRefused("ads.notYours");
  assertCan(actor, "ads.book", actor.vendorId);
  return actor.vendorId;
}

/** A banner's picture — an upload of the store's own, by its id — and its words. */
export type BannerRequest = { mediaId: string; headline: string; headlineAr?: string | null };

export type PlacementRequest = { productId: number; slot: AdSlot; startsOn: string; days: number; banner?: BannerRequest | null };

const flat = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * A banner's picture and words, checked: the picture is one this store
 * uploaded and is a banner's shape, the English headline is there, and
 * neither headline carries contact details. Answered as the columns to write.
 */
async function bannerColumns(db: Db, vendorId: number, banner: BannerRequest | null | undefined) {
  if (!banner?.mediaId) throw new AdRefused("ads.bannerNeedsImage");
  const [media] = await db
    .select({ id: mediaFiles.id, width: mediaFiles.width, height: mediaFiles.height })
    .from(mediaFiles)
    .where(and(eq(mediaFiles.id, banner.mediaId), eq(mediaFiles.vendorId, vendorId)))
    .limit(1);
  /* Another store's upload is "no picture", for the reason another store's booking is "not found". */
  if (!media) throw new AdRefused("ads.bannerNeedsImage");
  if (!bannerShapeOk(media.width, media.height)) throw new AdRefused("ads.bannerShape");
  const problem = headlineProblem(banner.headline, true, contactFindings) ?? headlineProblem(banner.headlineAr, false, contactFindings);
  if (problem) throw new AdRefused(problem);
  return {
    bannerMediaId: media.id,
    bannerHeadline: flat(banner.headline),
    bannerHeadlineAr: flat(banner.headlineAr) || null,
    bannerStatus: "pending" as const,
  };
}

/** The product a booking is for: this store's, on the shelf now. */
async function productFor(db: Db | Tx, vendorId: number, productId: number) {
  const [row] = await db
    .select({ id: products.id, title: products.title, status: products.status, categoryId: products.categoryId, vendorStatus: vendors.status })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(eq(products.id, productId), eq(products.vendorId, vendorId)))
    .limit(1);
  /* A draft, or a suspended store's product, would hold a paid place the
     shelf will not show — so it cannot be booked. */
  if (!row || row.status !== "published" || row.vendorStatus !== "approved") throw new AdRefused("ads.productUnavailable");
  return row;
}

/** Bookings in the same place whose runs overlap `[from, to]`. */
async function overlapping(db: Db | Tx, slot: AdSlot, categoryId: number | null, from: string, to: string) {
  return db
    .select({ startsOn: adBookings.startsOn, endsOn: adBookings.endsOn, dailyRate: adBookings.dailyRate, cancelledOn: adBookings.cancelledOn })
    .from(adBookings)
    .where(and(
      eq(adBookings.slot, slot),
      slot === "department" && categoryId !== null ? eq(adBookings.categoryId, categoryId) : undefined,
      lte(adBookings.startsOn, to),
      gte(adBookings.endsOn, from),
    ));
}

export type PlacementQuote = {
  cost: string;
  dailyRate: string;
  /** Days in the run already full, which the seller has to move off. */
  fullDays: string[];
  /** What the store can still commit to placements. */
  room: string;
  problem: AdRefusal | null;
};

/**
 * What a run would cost and whether it can be booked, without booking it —
 * the same checks `bookPlacement` makes, run early so the form can say which
 * one stands in the way. Read again inside the booking, under the locks.
 */
export async function quotePlacement(actor: Actor, request: PlacementRequest, now = new Date()): Promise<PlacementQuote> {
  const vendorId = storeOf(actor);
  const db = await handle();
  const today = kuwaitToday(now);
  const days = Number.isInteger(request.days) ? request.days : 0;
  const base = { cost: quoteFor(request.slot, Math.max(0, days)), dailyRate: AD_RATES[request.slot], fullDays: [] as string[], room: fromFils(await placementRoom(db, vendorId, now)) };

  const problem = bookingProblem(request, today);
  if (problem) return { ...base, problem };
  try {
    const product = await productFor(db, vendorId, request.productId);
    if (request.slot === "department" && product.categoryId === null) return { ...base, problem: "ads.noDepartment" };
    const ends = addDays(request.startsOn, request.days - 1);
    const full = fullDays(await overlapping(db, request.slot, product.categoryId, request.startsOn, ends), request.startsOn, request.days, AD_CAPACITY[request.slot]);
    if (full.length) return { ...base, fullDays: full, problem: "ads.full" };
    if (toFils(base.cost) > toFils(base.room)) return { ...base, problem: "ads.notEnoughEarned" };
    return { ...base, problem: null };
  } catch (error) {
    if (error instanceof AdRefused) return { ...base, problem: error.reason };
    throw error;
  }
}

/** Book a run. Every check is made again here, under the locks. */
export async function bookPlacement(actor: Actor, request: PlacementRequest, now = new Date()): Promise<{ id: number; total: string }> {
  const vendorId = storeOf(actor);
  const db = await handle();
  const today = kuwaitToday(now);
  const problem = bookingProblem(request, today);
  if (problem) throw new AdRefused(problem);
  const endsOn = addDays(request.startsOn, request.days - 1);
  const total = quoteFor(request.slot, request.days);
  const banner = request.slot === "home_banner" ? await bannerColumns(db, vendorId, request.banner) : {};

  const booked = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOKING_LOCK})`);
    await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).for("update");

    const product = await productFor(tx, vendorId, request.productId);
    if (request.slot === "department" && product.categoryId === null) throw new AdRefused("ads.noDepartment");
    const categoryId = request.slot === "department" ? product.categoryId : null;

    const full = fullDays(await overlapping(tx, request.slot, categoryId, request.startsOn, endsOn), request.startsOn, request.days, AD_CAPACITY[request.slot]);
    if (full.length) throw new AdRefused("ads.full", full);
    if (toFils(total) > await placementRoom(tx, vendorId, now)) throw new AdRefused("ads.notEnoughEarned");

    const [row] = await tx
      .insert(adBookings)
      .values({
        vendorId,
        productId: product.id,
        productTitle: product.title.slice(0, 255),
        slot: request.slot,
        categoryId,
        startsOn: request.startsOn,
        endsOn,
        dailyRate: AD_RATES[request.slot],
        total,
        bookedBy: actor.userId,
        ...banner,
      })
      .returning({ id: adBookings.id, total: adBookings.total, title: adBookings.productTitle });
    return row;
  });

  await recordAudit(await auditActor(actor), {
    action: "ads.book",
    subjectType: "placement",
    subjectId: booked.id,
    subjectLabel: booked.title,
    vendorId,
    after: { slot: request.slot, startsOn: request.startsOn, endsOn, total: booked.total, ...("bannerHeadline" in banner ? { headline: banner.bannerHeadline } : {}) },
  });
  return { id: booked.id, total: booked.total };
}

/**
 * Stop a booking. Before it starts it costs nothing; while it runs it ends
 * today and today is charged, because it has already been shown.
 *
 * The "not already cancelled, not over" rule is in the `UPDATE`'s predicate,
 * so a seller and an administrator pressing at once cannot both stop it and
 * the second is told so.
 */
export async function cancelPlacement(actor: Actor, bookingId: number, now = new Date()): Promise<void> {
  const db = await handle();
  const today = kuwaitToday(now);
  let scope: number | undefined;
  if (actor.kind === "vendor") {
    assertCan(actor, "ads.book", actor.vendorId);
    scope = actor.vendorId;
  } else {
    assertCan(actor, "ads.book");
  }

  const [found] = await db
    .select({ id: adBookings.id, vendorId: adBookings.vendorId, title: adBookings.productTitle })
    .from(adBookings)
    .where(and(eq(adBookings.id, bookingId), scope === undefined ? undefined : eq(adBookings.vendorId, scope)))
    .limit(1);
  if (!found) throw new AdRefused("ads.notFound");

  const [stopped] = await db
    .update(adBookings)
    .set({ cancelledOn: today, cancelledBy: actor.userId })
    .where(and(eq(adBookings.id, bookingId), isNull(adBookings.cancelledOn), gte(adBookings.endsOn, today)))
    .returning({ id: adBookings.id });
  if (!stopped) throw new AdRefused("ads.notCancellable");

  await recordAudit(await auditActor(actor), {
    action: "ads.cancel",
    subjectType: "placement",
    subjectId: found.id,
    subjectLabel: found.title,
    vendorId: found.vendorId,
    after: { cancelledOn: today },
  });
}

/**
 * NetLet's answer on a banner waiting for review.
 *
 * **Approving never charges for a day it waited**: a banner approved after its
 * first day starts on the day of approval, and its recorded total shrinks to
 * match. One already past its last day cannot be approved — it was never
 * shown and never will be — so the answer to it is a rejection. **Rejecting
 * says why** and cancels the run before its first day, so it costs nothing
 * and gives its place back.
 *
 * The row is read first and written with what was read in the predicate —
 * still waiting, not withdrawn, the same start — so two administrators
 * answering at once, or a store withdrawing it while it is approved, cannot
 * both land.
 */
export async function reviewBanner(
  actor: Actor,
  request: { id: number; decision: "approve" | "reject"; note?: string | null },
  now = new Date(),
): Promise<{ startsOn: string; status: BannerStatus }> {
  assertCan(actor, "product.review");
  const db = await handle();
  const today = kuwaitToday(now);
  const note = flat(request.note).slice(0, 400) || null;
  if (request.decision === "reject" && !note) throw new AdRefused("ads.bannerNeedsNote");

  const [found] = await db
    .select({
      id: adBookings.id,
      vendorId: adBookings.vendorId,
      title: adBookings.productTitle,
      slot: adBookings.slot,
      status: adBookings.bannerStatus,
      startsOn: adBookings.startsOn,
      endsOn: adBookings.endsOn,
      dailyRate: adBookings.dailyRate,
      cancelledOn: adBookings.cancelledOn,
    })
    .from(adBookings)
    .where(eq(adBookings.id, request.id))
    .limit(1);
  if (!found || found.slot !== "home_banner") throw new AdRefused("ads.notFound");
  if (found.status !== "pending" || found.cancelledOn !== null) throw new AdRefused("ads.bannerNotWaiting");

  const waiting = and(eq(adBookings.id, found.id), eq(adBookings.bannerStatus, "pending"), isNull(adBookings.cancelledOn), eq(adBookings.startsOn, found.startsOn));
  let startsOn = found.startsOn;
  let status: BannerStatus;
  if (request.decision === "approve") {
    if (found.endsOn < today) throw new AdRefused("ads.bannerLapsed");
    startsOn = approvalStart(found.startsOn, today);
    const total = fromFils(toFils(found.dailyRate) * BigInt(daysInclusive(startsOn, found.endsOn)));
    const [done] = await db
      .update(adBookings)
      .set({ bannerStatus: "approved", bannerNote: note, bannerReviewedBy: actor.userId, bannerReviewedAt: now, startsOn, total })
      .where(waiting)
      .returning({ id: adBookings.id });
    if (!done) throw new AdRefused("ads.bannerNotWaiting");
    status = "approved";
  } else {
    const [done] = await db
      .update(adBookings)
      /* The day before it starts: a run with no days, so no fee and no place held. */
      .set({ bannerStatus: "rejected", bannerNote: note, bannerReviewedBy: actor.userId, bannerReviewedAt: now, cancelledOn: addDays(found.startsOn, -1), cancelledBy: actor.userId })
      .where(waiting)
      .returning({ id: adBookings.id });
    if (!done) throw new AdRefused("ads.bannerNotWaiting");
    status = "rejected";
  }

  await recordAudit(await auditActor(actor), {
    action: status === "approved" ? "ads.bannerApprove" : "ads.bannerReject",
    subjectType: "placement",
    subjectId: found.id,
    subjectLabel: found.title,
    vendorId: found.vendorId,
    before: { status: "pending", startsOn: found.startsOn },
    after: { status, startsOn, note },
  });
  return { startsOn, status };
}

/** Banners waiting on NetLet that can still run, for the overview's count. */
export async function countWaitingBanners(actor: Actor, now = new Date()): Promise<number> {
  assertCan(actor, "product.review");
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adBookings)
    .where(and(eq(adBookings.slot, "home_banner"), eq(adBookings.bannerStatus, "pending"), isNull(adBookings.cancelledOn), gte(adBookings.endsOn, kuwaitToday(now))));
  return row?.n ?? 0;
}

export type BannerView = {
  status: BannerStatus;
  imageUrl: string | null;
  headline: string;
  headlineAr: string | null;
  note: string | null;
  /** The store's discount permit now, for a reviewer reading a headline that promises a saving. */
  permit: "valid" | "missing" | "expired";
};

export type PlacementView = {
  id: number;
  vendorId: number;
  vendorName: string;
  productTitle: string;
  productHandle: string | null;
  slot: AdSlot;
  departmentName: string | null;
  departmentNameAr: string | null;
  startsOn: string;
  endsOn: string;
  cancelledOn: string | null;
  dailyRate: string;
  total: string;
  state: BookingState;
  /** What it has cost so far. */
  accrued: string;
  /** What payouts have already taken for it. */
  deducted: string;
  cancellable: boolean;
  /** A `home_banner` booking's picture, words and review; null for a shelf placement. */
  banner: BannerView | null;
};

/**
 * Bookings, newest first: one store's, or every store's for an administrator.
 * `waiting` narrows to banners waiting on NetLet that can still run — the
 * review queue, filtered on the server for the reason every portal filter is.
 */
export async function listPlacements(actor: Actor, request: { page?: number; pageSize?: number; waiting?: boolean } = {}, now = new Date()): Promise<Page<PlacementView>> {
  let scope: number | undefined;
  if (actor.kind === "vendor") {
    assertCan(actor, "ads.book", actor.vendorId);
    scope = actor.vendorId;
  } else {
    assertCan(actor, "ads.book");
  }
  const db = await handle();
  const today = kuwaitToday(now);
  const pageSize = clampPageSize(request.pageSize ?? 20);
  const filter = and(
    scope === undefined ? undefined : eq(adBookings.vendorId, scope),
    request.waiting
      ? and(eq(adBookings.slot, "home_banner"), eq(adBookings.bannerStatus, "pending"), isNull(adBookings.cancelledOn), gte(adBookings.endsOn, today))
      : undefined,
  );
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(adBookings).where(filter);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);

  const rows = await db
    .select({
      booking: adBookings,
      vendorName: vendors.name,
      productHandle: products.handle,
      departmentName: categories.name,
      departmentNameAr: categories.nameAr,
      deducted: sql<string | null>`(select sum(${payoutRunItems.amount}) from ${payoutRunItems} where ${payoutRunItems.bookingId} = ${adBookings.id})`,
      mediaType: mediaFiles.contentType,
      permitNumber: vendors.discountLicenceNumber,
      permitExpires: vendors.discountLicenceExpiresAt,
    })
    .from(adBookings)
    .innerJoin(vendors, eq(adBookings.vendorId, vendors.id))
    .leftJoin(products, eq(adBookings.productId, products.id))
    .leftJoin(categories, eq(adBookings.categoryId, categories.id))
    .leftJoin(mediaFiles, eq(adBookings.bannerMediaId, mediaFiles.id))
    .where(filter)
    /* Ends on the id, which is unique, for the reason every paged list here does. */
    .orderBy(desc(adBookings.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));

  return {
    rows: rows.map(({ booking, vendorName, productHandle, departmentName, departmentNameAr, deducted, mediaType, permitNumber, permitExpires }) => ({
      id: booking.id,
      vendorId: booking.vendorId,
      vendorName,
      productTitle: booking.productTitle,
      productHandle,
      slot: booking.slot,
      departmentName,
      departmentNameAr,
      startsOn: booking.startsOn,
      endsOn: booking.endsOn,
      cancelledOn: booking.cancelledOn,
      dailyRate: booking.dailyRate,
      total: booking.total,
      state: bookingState(booking, today),
      accrued: fromFils(feeAccrued(booking, today)),
      /* Stored negative; shown as what was taken. */
      deducted: fromFils(-toFils(deducted ?? "0")),
      cancellable: cancellable(booking, today),
      banner: booking.slot === "home_banner" && booking.bannerStatus
        ? {
            status: booking.bannerStatus,
            imageUrl: booking.bannerMediaId && mediaType ? mediaPath(booking.bannerMediaId, mediaType as StoredType) : null,
            headline: booking.bannerHeadline ?? "",
            headlineAr: booking.bannerHeadlineAr,
            note: booking.bannerNote,
            permit: permitState(permitNumber, permitExpires, now),
          }
        : null,
    })),
    total,
    page,
    pageSize,
  };
}

function permitState(number: string | null, expiresAt: Date | null, now: Date): BannerView["permit"] {
  const verdict = discountAllowed({ number, expiresAt }, now);
  return verdict.allowed ? "valid" : verdict.reason;
}

export type HomeBanner = {
  id: number;
  imageUrl: string;
  /** In the reader's language when the store wrote one, else the English. */
  headline: string;
  productHandle: string;
  storeName: string;
};

/**
 * The home page's banners today: approved, running, first booked first, and
 * only while the product they link to is in the shop — drawn through
 * `listProductsByIds`, so a banner for an unpublished product or a suspended
 * store is absent for the reason the product is. Nothing here is a house
 * banner: with nothing approved, the carousel is not drawn.
 */
export async function bannersToday(options: { locale?: LocalePick } = {}, now = new Date()): Promise<HomeBanner[]> {
  const db = await getDb();
  if (!db) return [];
  const today = kuwaitToday(now);
  const running = await db
    .select({
      id: adBookings.id,
      productId: adBookings.productId,
      mediaId: adBookings.bannerMediaId,
      mediaType: mediaFiles.contentType,
      headline: adBookings.bannerHeadline,
      headlineAr: adBookings.bannerHeadlineAr,
    })
    .from(adBookings)
    .innerJoin(mediaFiles, eq(adBookings.bannerMediaId, mediaFiles.id))
    .where(and(
      eq(adBookings.slot, "home_banner"),
      eq(adBookings.bannerStatus, "approved"),
      lte(adBookings.startsOn, today),
      gte(adBookings.endsOn, today),
      sql`(${adBookings.cancelledOn} is null or ${adBookings.cancelledOn} >= ${today})`,
    ))
    .orderBy(asc(adBookings.id))
    .limit(AD_CAPACITY.home_banner);
  if (running.length === 0) return [];

  const locale = options.locale ?? "en";
  const shown = await listProductsByIds([...new Set(running.flatMap(row => (row.productId === null ? [] : [row.productId])))], locale);
  const byId = new Map(shown.map(product => [Number(product.id), product]));
  return running.flatMap(row => {
    const product = row.productId === null ? undefined : byId.get(row.productId);
    if (!product || !row.mediaId || !row.mediaType) return [];
    const arabic = locale === "ar" && Boolean(row.headlineAr);
    return [{
      id: row.id,
      imageUrl: mediaPath(row.mediaId, row.mediaType as StoredType),
      headline: (arabic ? row.headlineAr : row.headline) ?? "",
      productHandle: product.handle,
      storeName: product.vendor ?? "",
    }];
  });
}

/**
 * What a place shows today, as storefront products, first booked first.
 *
 * Drawn through `listProductsByIds`, so a booked product that has since been
 * unpublished — or whose store was suspended — is absent here for the reason
 * it is absent from the shop. A department placement shows only while the
 * product is still in that department.
 */
export async function sponsoredToday(
  slot: Exclude<AdSlot, "home_banner">,
  options: { departmentSlug?: string; locale?: LocalePick } = {},
  now = new Date(),
): Promise<Product[]> {
  const db = await getDb();
  if (!db) return [];
  const today = kuwaitToday(now);

  let categoryId: number | null = null;
  if (slot === "department") {
    if (!options.departmentSlug) return [];
    const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, options.departmentSlug)).limit(1);
    if (!category) return [];
    categoryId = category.id;
  }

  const running = await db
    .select({ productId: adBookings.productId, productCategory: products.categoryId })
    .from(adBookings)
    .innerJoin(products, eq(adBookings.productId, products.id))
    .where(and(
      eq(adBookings.slot, slot),
      categoryId === null ? undefined : eq(adBookings.categoryId, categoryId),
      lte(adBookings.startsOn, today),
      gte(adBookings.endsOn, today),
      /* Cancelled today still ran today, and was charged for it. */
      sql`(${adBookings.cancelledOn} is null or ${adBookings.cancelledOn} >= ${today})`,
    ))
    .orderBy(asc(adBookings.id))
    .limit(AD_CAPACITY[slot]);

  const ids = [...new Set(
    running
      .filter(row => categoryId === null || row.productCategory === categoryId)
      .map(row => row.productId!)
  )];
  return listProductsByIds(ids, options.locale ?? "en");
}
