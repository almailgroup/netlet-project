/**
 * After the door: rating a delivery (3.4.4) and claiming for damage (3.4.2).
 *
 * The rules are pure and live in `Shared/commerce/deliveryRatings.ts` and
 * `Shared/commerce/damageClaims.ts`; this is the part that needs a database.
 * Outside `db.ts` for the reason every testable module is.
 *
 * **Both start from a parcel re-derived here**, never from one the caller
 * describes. A parcel has no row — it is an order's lines grouped by seller and
 * door — so the caller names an order it can prove it owns and either a key or
 * the lines, and the grouping is done again against what is stored. That is
 * the argument `dispatch.ts` makes for `parcelIn`.
 *
 * **A returned line still arrived.** The dispatch board drops a returned line
 * from its parcel, because a return is a different journey and not dispatch
 * work. Here it is the opposite: whoever sent the lamp back may be exactly the
 * shopper whose box came in crushed, so a line with a `delivered_at` counts as
 * delivered for both a rating and a claim, whatever it reads now.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { couriers, damageClaims, deliveryRatings, orderItems, orders } from "../../database/schema.js";
import { parcelsOf, type Parcel, type ParcelLine } from "../../../Shared/commerce/parcels.js";
import {
  cleanDeliveryComment,
  deliveryRatingState,
  isValidRating,
  overallOf,
  partsValid,
  type RatingPart,
  parcelArrivedAt,
  scoresByCarrier,
  type DeliveryRatingState,
} from "../../../Shared/commerce/deliveryRatings.js";
import {
  amountRefusal,
  claimCeiling,
  claimRefusal,
  evidenceRefusal,
  liabilityByCourier,
  MAX_CLAIM_DESCRIPTION,
  paidLineIds,
  MAX_CLAIM_RESPONSE,
  type ClaimFiler,
  type ClaimRefusal,
} from "../../../Shared/commerce/damageClaims.js";
import { assertCan, readableCouriers, type Actor } from "../../../Shared/inventory/permissions.js";
import { violatesUnique } from "../core/describeError.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** A refusal the caller can act on, as a message key. */
export class ParcelCareRefused extends Error {
  constructor(readonly reason: ClaimRefusal | "delivery.notArrived" | "delivery.ratingClosed" | "delivery.invalidRating" | "parcel.notFound") {
    super(reason);
    this.name = "ParcelCareRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

type CareLine = ParcelLine & { lineTotal: string; deliveredAt: Date | null; currentFulfilment: string };
export type CareParcel = Omit<Parcel, "lines"> & { lines: CareLine[]; arrivedAt: Date | null };

/** Every parcel of one order, as far as rating and claiming are concerned. */
export async function parcelsOfOrder(db: Db, orderId: number): Promise<CareParcel[]> {
  const rows = await db
    .select({
      lineId: orderItems.id,
      vendorId: orderItems.vendorId,
      vendorName: orderItems.vendorName,
      productTitle: orderItems.productTitle,
      variantTitle: orderItems.variantTitle,
      quantity: orderItems.quantity,
      fulfilment: orderItems.fulfilment,
      sizeClass: orderItems.sizeClass,
      weightGrams: orderItems.weightGrams,
      destination: orderItems.destination,
      courierId: orderItems.courierId,
      centreId: orderItems.centreId,
      deliveryChoice: orderItems.deliveryChoice,
      lineTotal: orderItems.lineTotal,
      deliveredAt: orderItems.deliveredAt,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.id);

  const lines: CareLine[] = rows.map(row => ({
    ...(row as unknown as ParcelLine),
    lineTotal: row.lineTotal,
    deliveredAt: row.deliveredAt,
    currentFulfilment: row.fulfilment,
    /* Arrived is a date: a line sent back afterwards still arrived. */
    fulfilment: row.fulfilment === "returned" && row.deliveredAt ? "delivered" : row.fulfilment,
  }));

  return parcelsOf(lines).map(parcel => ({
    ...parcel,
    lines: parcel.lines as CareLine[],
    arrivedAt: parcelArrivedAt(parcel.lines as CareLine[]),
  }));
}

async function ownOrder(db: Db, userId: number, reference: string) {
  const [order] = await db
    .select({ id: orders.id, reference: orders.reference })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.reference, reference)))
    .limit(1);
  /* Somebody else's reference is not found, never "not yours": an answer that
     differs would confirm the order exists. */
  if (!order) throw new ParcelCareRefused("parcel.notFound");
  return order;
}

/* ---------------------------------------------------------- the shopper --- */

export type ShopperParcel = {
  key: string;
  vendorName: string | null;
  destinationLabel: string | null;
  state: string;
  arrivedAt: Date | null;
  /** The lines in it, so a claim can name which were damaged — less any an accepted claim already paid for. */
  lines: { lineId: number; productTitle: string; lineTotal: string }[];
  rating: { rating: number; comment: string | null; speed: number | null; condition: number | null; conduct: number | null } | null;
  ratingState: DeliveryRatingState;
  /** The latest claim on it, if any — what the shopper is waiting to hear. */
  claim: { id: number; status: string; claimedAmount: string; awardedAmount: string | null; decisionNote: string | null } | null;
  /** Null when a claim may be filed now; otherwise why not. */
  claimRefusal: ClaimRefusal | null;
};

/**
 * The parcels of one of this shopper's orders, each with what can be done
 * about it. Resolved here with the server's clock, so neither window can be
 * reopened by changing a phone's date.
 */
export async function parcelsForShopper(userId: number, reference: string, now = new Date()): Promise<ShopperParcel[]> {
  const db = await handle();
  const order = await ownOrder(db, userId, reference);
  const parcels = await parcelsOfOrder(db, order.id);
  if (parcels.length === 0) return [];

  const ratings = await db
    .select({
      parcelKey: deliveryRatings.parcelKey,
      rating: deliveryRatings.rating,
      comment: deliveryRatings.comment,
      speed: deliveryRatings.speed,
      condition: deliveryRatings.condition,
      conduct: deliveryRatings.conduct,
    })
    .from(deliveryRatings)
    .where(eq(deliveryRatings.orderId, order.id));
  const claims = await db
    .select({
      id: damageClaims.id,
      parcelKey: damageClaims.parcelKey,
      status: damageClaims.status,
      claimedAmount: damageClaims.claimedAmount,
      awardedAmount: damageClaims.awardedAmount,
      decisionNote: damageClaims.decisionNote,
      lineIds: damageClaims.lineIds,
    })
    .from(damageClaims)
    .where(eq(damageClaims.orderId, order.id))
    .orderBy(desc(damageClaims.id));
  const paid = paidLineIds(claims);

  return parcels.map(parcel => {
    const rating = ratings.find(row => row.parcelKey === parcel.key) ?? null;
    const claim = claims.find(row => row.parcelKey === parcel.key) ?? null;
    const unpaid = parcel.lines.filter(line => !paid.has(line.lineId));
    const refusal: ClaimRefusal | null =
      claim?.status === "open" ? "claims.alreadyOpen"
        : unpaid.length === 0 ? "claims.alreadyPaid"
          : claimRefusal(parcel, "shopper", now);
    return {
      key: parcel.key,
      vendorName: parcel.vendorName,
      destinationLabel: parcel.destination?.label ?? null,
      state: parcel.state,
      arrivedAt: parcel.arrivedAt,
      lines: unpaid.map(line => ({ lineId: line.lineId, productTitle: line.productTitle, lineTotal: line.lineTotal })),
      rating: rating ? { rating: rating.rating, comment: rating.comment, speed: rating.speed, condition: rating.condition, conduct: rating.conduct } : null,
      ratingState: deliveryRatingState(parcel.arrivedAt, now),
      claim: claim
        ? { id: claim.id, status: claim.status, claimedAmount: claim.claimedAmount, awardedAmount: claim.awardedAmount, decisionNote: claim.decisionNote }
        : null,
      claimRefusal: refusal,
    };
  });
}

/**
 * Rate how a parcel was delivered, or change the rating.
 *
 * An upsert on (order, parcel), so pressing four stars and then five is one
 * rating that changed rather than two. The carrier is frozen when the rating
 * is first written and kept on a change: the score is about who carried it,
 * and a parcel's assignment moving afterwards is a correction to the board,
 * not a different delivery.
 *
 * Rated on its three parts (3.4.4), and the overall is their average
 * (`overallOf`). A rating of one figure alone is still taken — the app on a
 * phone that has not updated sends one — and stores no parts.
 */
export async function rateDelivery(
  userId: number,
  input: { reference: string; parcelKey: string; rating?: number | null; speed?: number | null; condition?: number | null; conduct?: number | null; comment?: string | null },
  now = new Date(),
): Promise<void> {
  const parts = input.speed != null || input.condition != null || input.conduct != null ? { speed: input.speed, condition: input.condition, conduct: input.conduct } : null;
  if (parts && !partsValid(parts)) throw new ParcelCareRefused("delivery.invalidRating");
  const rating = parts && partsValid(parts) ? overallOf(parts) : input.rating;
  if (rating == null || !isValidRating(rating)) throw new ParcelCareRefused("delivery.invalidRating");
  const stored = parts && partsValid(parts) ? parts : { speed: null, condition: null, conduct: null };
  const db = await handle();
  const order = await ownOrder(db, userId, input.reference);
  const parcel = (await parcelsOfOrder(db, order.id)).find(one => one.key === input.parcelKey);
  if (!parcel) throw new ParcelCareRefused("parcel.notFound");

  const state = deliveryRatingState(parcel.arrivedAt, now);
  if (!state.allowed) throw new ParcelCareRefused(state.reason);

  const comment = cleanDeliveryComment(input.comment);
  await db
    .insert(deliveryRatings)
    .values({
      orderId: order.id,
      userId,
      parcelKey: parcel.key,
      vendorId: parcel.vendorId,
      vendorName: parcel.vendorName,
      courierId: parcel.courierId,
      rating,
      ...stored,
      comment,
    })
    .onConflictDoUpdate({
      target: [deliveryRatings.orderId, deliveryRatings.parcelKey],
      set: { rating, ...stored, comment, updatedAt: now },
    });
}

/* ------------------------------------------------------------- the score --- */

export type DeliveryScores = {
  scores: { courierId: number | null; courierName: string | null; count: number; average: number; distribution: Record<number, number>; parts: Record<RatingPart, number | null> }[];
  /** The latest comments, without the shopper's identity — never a name, never an email. */
  recent: { rating: number; speed: number | null; condition: number | null; conduct: number | null; comment: string | null; createdAt: Date; courierId: number | null; vendorName: string | null }[];
};

/** How many recent comments the page shows. A page, not an archive. */
export const RECENT_RATINGS = 20;

/**
 * Each delivery company's score, for whoever may see it.
 *
 * An administrator sees every company and the parcels sellers carried
 * themselves; a company sees its own score and nothing about a rival's —
 * scoped in the query by `readableCouriers`, the way the board is.
 */
export async function deliveryScores(actor: Actor): Promise<DeliveryScores> {
  assertCan(actor, "delivery.view");
  const db = await handle();
  const scope = readableCouriers(actor);
  const mine = scope === "all" ? undefined : inArray(deliveryRatings.courierId, scope.length ? scope : [-1]);

  const rows = await db
    .select({
      courierId: deliveryRatings.courierId,
      rating: deliveryRatings.rating,
      speed: deliveryRatings.speed,
      condition: deliveryRatings.condition,
      conduct: deliveryRatings.conduct,
    })
    .from(deliveryRatings)
    .where(mine);
  const recent = await db
    .select({
      rating: deliveryRatings.rating,
      speed: deliveryRatings.speed,
      condition: deliveryRatings.condition,
      conduct: deliveryRatings.conduct,
      comment: deliveryRatings.comment,
      createdAt: deliveryRatings.createdAt,
      courierId: deliveryRatings.courierId,
      vendorName: deliveryRatings.vendorName,
    })
    .from(deliveryRatings)
    .where(mine)
    .orderBy(desc(deliveryRatings.updatedAt), desc(deliveryRatings.id))
    .limit(RECENT_RATINGS);

  const names = new Map((await db.select({ id: couriers.id, name: couriers.name }).from(couriers)).map(row => [row.id, row.name]));
  return {
    scores: scoresByCarrier(rows).map(score => ({
      courierId: score.courierId,
      courierName: score.courierId === null ? null : names.get(score.courierId) ?? null,
      ...score.summary,
      parts: score.parts,
    })),
    recent,
  };
}

/* ------------------------------------------------------------- the claim --- */

export type ClaimFilerIdentity =
  | { kind: "shopper"; userId: number; reference: string }
  | { kind: "actor"; actor: Actor; orderId: number };

/**
 * File a claim that a parcel arrived damaged.
 *
 * Named by the damaged lines rather than by a parcel key, because the lines are
 * what the filer is looking at; the parcel is derived from them, and lines from
 * two parcels in one claim are refused — two boxes on two vans are two claims
 * against possibly two companies.
 */
export async function fileClaim(
  filer: ClaimFilerIdentity,
  input: { lineIds: number[]; amount: string; description: string; evidenceUrl?: string | null },
  now = new Date(),
): Promise<{ id: number }> {
  const db = await handle();

  let orderId: number;
  let filedAs: ClaimFiler;
  let filedBy: number;
  if (filer.kind === "shopper") {
    orderId = (await ownOrder(db, filer.userId, filer.reference)).id;
    filedAs = "shopper";
    filedBy = filer.userId;
  } else {
    assertCan(filer.actor, "delivery.fileClaim");
    orderId = filer.orderId;
    filedAs = filer.actor.kind === "admin" ? "admin" : "seller";
    filedBy = filer.actor.userId;
  }

  const wanted = [...new Set(input.lineIds)];
  if (wanted.length === 0) throw new ParcelCareRefused("claims.noLines");

  const parcels = await parcelsOfOrder(db, orderId);
  const parcel = parcels.find(one => one.lines.some(line => line.lineId === wanted[0]));
  if (!parcel) throw new ParcelCareRefused("parcel.notFound");
  /* A seller claims for their own goods and nobody else's — scoped to the
     parcel's vendor, which also refuses an order holding none of theirs. */
  if (filer.kind === "actor") assertCan(filer.actor, "delivery.fileClaim", parcel.vendorId ?? -1);

  const chosen = parcel.lines.filter(line => wanted.includes(line.lineId));
  if (chosen.length !== wanted.length) throw new ParcelCareRefused("claims.notInParcel");

  /* Paid once is paid: an accepted claim's lines are not claimable again. */
  const earlier = await db
    .select({ status: damageClaims.status, lineIds: damageClaims.lineIds })
    .from(damageClaims)
    .where(and(eq(damageClaims.orderId, orderId), eq(damageClaims.status, "accepted")));
  const paid = paidLineIds(earlier);
  if (chosen.some(line => paid.has(line.lineId))) throw new ParcelCareRefused("claims.alreadyPaid");

  const refused =
    claimRefusal(parcel, filedAs, now) ??
    amountRefusal(input.amount, claimCeiling(chosen)) ??
    evidenceRefusal(input.evidenceUrl?.trim() || null);
  if (refused) throw new ParcelCareRefused(refused);

  const description = input.description.trim().slice(0, MAX_CLAIM_DESCRIPTION);
  if (!description) throw new ParcelCareRefused("claims.needsDescription");

  try {
    const [row] = await db
      .insert(damageClaims)
      .values({
        orderId,
        parcelKey: parcel.key,
        vendorId: parcel.vendorId,
        vendorName: parcel.vendorName,
        courierId: parcel.courierId,
        filedBy,
        filedAs,
        lineIds: chosen.map(line => line.lineId),
        claimedAmount: input.amount,
        description,
        evidenceUrl: input.evidenceUrl?.trim() || null,
      })
      .returning({ id: damageClaims.id });
    return row;
  } catch (error) {
    /* Two tabs, or the shopper and the seller at once: one open claim per
       parcel, and the second is told so rather than handed a 500. */
    if (violatesUnique(error, "damage_claims_open_unique")) throw new ParcelCareRefused("claims.alreadyOpen");
    throw error;
  }
}

export type ClaimRow = {
  id: number;
  orderId: number;
  reference: string;
  vendorId: number | null;
  vendorName: string | null;
  courierId: number | null;
  courierName: string | null;
  filedAs: string;
  lines: { lineId: number; productTitle: string; lineTotal: string }[];
  claimedAmount: string;
  description: string;
  evidenceUrl: string | null;
  courierResponse: string | null;
  courierRespondedAt: Date | null;
  status: string;
  awardedAmount: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

/** How many claims a page reads. Newest first; the ledger above is the total. */
export const CLAIM_PAGE = 100;

/**
 * The claims this actor may see.
 *
 * An admin sees every claim; a delivery company sees the claims against it;
 * a seller sees the claims on their own goods. Scoped in the `WHERE`, because
 * a claim names a company's liability and a seller's goods, and neither is any
 * other party's business.
 */
export async function listClaims(actor: Actor, filter: { status?: "open" | "accepted" | "rejected" } = {}): Promise<ClaimRow[]> {
  const db = await handle();
  let scope;
  if (actor.kind === "admin") scope = undefined;
  else if (actor.kind === "courier") scope = eq(damageClaims.courierId, actor.courierId);
  else if (actor.kind === "vendor") {
    assertCan(actor, "delivery.fileClaim", actor.vendorId);
    scope = eq(damageClaims.vendorId, actor.vendorId);
  } else throw new Error("FORBIDDEN:delivery.view");

  const rows = await db
    .select({
      id: damageClaims.id,
      orderId: damageClaims.orderId,
      reference: orders.reference,
      vendorId: damageClaims.vendorId,
      vendorName: damageClaims.vendorName,
      courierId: damageClaims.courierId,
      courierName: couriers.name,
      filedAs: damageClaims.filedAs,
      lineIds: damageClaims.lineIds,
      claimedAmount: damageClaims.claimedAmount,
      description: damageClaims.description,
      evidenceUrl: damageClaims.evidenceUrl,
      courierResponse: damageClaims.courierResponse,
      courierRespondedAt: damageClaims.courierRespondedAt,
      status: damageClaims.status,
      awardedAmount: damageClaims.awardedAmount,
      decisionNote: damageClaims.decisionNote,
      decidedAt: damageClaims.decidedAt,
      createdAt: damageClaims.createdAt,
    })
    .from(damageClaims)
    .innerJoin(orders, eq(orders.id, damageClaims.orderId))
    .leftJoin(couriers, eq(couriers.id, damageClaims.courierId))
    .where(and(scope, filter.status ? eq(damageClaims.status, filter.status) : undefined))
    .orderBy(desc(damageClaims.createdAt), desc(damageClaims.id))
    .limit(CLAIM_PAGE);

  const lineIds = [...new Set(rows.flatMap(row => row.lineIds ?? []))];
  const lines = lineIds.length
    ? await db
        .select({ lineId: orderItems.id, productTitle: orderItems.productTitle, lineTotal: orderItems.lineTotal })
        .from(orderItems)
        .where(inArray(orderItems.id, lineIds))
    : [];
  const lineById = new Map(lines.map(line => [line.lineId, line]));

  return rows.map(({ lineIds: ids, ...row }) => ({
    ...row,
    lines: (ids ?? []).map(id => lineById.get(id)).filter((line): line is NonNullable<typeof line> => Boolean(line)),
  }));
}

/**
 * The delivery company's account of it.
 *
 * Its own claims only, and only while open: once NetLet has decided, a
 * response is no longer an account given before the decision, which is the only
 * thing that makes it worth recording.
 */
export async function respondToClaim(actor: Actor, claimId: number, response: string, now = new Date()): Promise<void> {
  if (actor.kind !== "courier") throw new Error("FORBIDDEN:delivery.move");
  const text = response.trim().slice(0, MAX_CLAIM_RESPONSE);
  if (!text) throw new ParcelCareRefused("claims.needsDescription");

  const db = await handle();
  const [row] = await db
    .update(damageClaims)
    .set({ courierResponse: text, courierRespondedAt: now })
    .where(and(
      eq(damageClaims.id, claimId),
      eq(damageClaims.courierId, actor.courierId),
      eq(damageClaims.status, "open"),
    ))
    .returning({ id: damageClaims.id });
  if (!row) throw new ParcelCareRefused("claims.notOpen");
}

/**
 * NetLet's decision: accept with an award, or reject.
 *
 * The predicate is inside the `UPDATE`, so two administrators deciding at once
 * cannot both be told they did. An award is at most what was claimed — itself
 * capped by what the lines sold for — and an acceptance at nothing is a
 * rejection wearing the wrong word, so it is refused.
 */
export async function decideClaim(
  actor: Actor,
  claimId: number,
  decision: { outcome: "accepted" | "rejected"; awardedAmount?: string | null; note?: string | null },
  now = new Date(),
): Promise<void> {
  assertCan(actor, "delivery.decideClaims");
  const db = await handle();

  const [claim] = await db
    .select({ id: damageClaims.id, status: damageClaims.status, claimedAmount: damageClaims.claimedAmount, courierId: damageClaims.courierId, vendorId: damageClaims.vendorId })
    .from(damageClaims)
    .where(eq(damageClaims.id, claimId))
    .limit(1);
  if (!claim) throw new ParcelCareRefused("parcel.notFound");
  if (claim.status !== "open") throw new ParcelCareRefused("claims.notOpen");

  let awarded: string | null = null;
  if (decision.outcome === "accepted") {
    awarded = decision.awardedAmount?.trim() || claim.claimedAmount;
    const refused = amountRefusal(awarded, claim.claimedAmount);
    if (refused) throw new ParcelCareRefused(refused);
  }

  const note = decision.note?.trim().slice(0, 500) || null;
  const [row] = await db
    .update(damageClaims)
    .set({ status: decision.outcome, awardedAmount: awarded, decisionNote: note, decidedBy: actor.userId, decidedAt: now })
    .where(and(eq(damageClaims.id, claimId), eq(damageClaims.status, "open")))
    .returning({ id: damageClaims.id });
  if (!row) throw new ParcelCareRefused("claims.notOpen");

  /* A decision assigns money between two companies, which is what the trail
     is for. */
  await recordAudit(
    await auditActor(actor),
    {
      action: "delivery.decideClaim",
      subjectType: "claim",
      subjectId: claimId,
      vendorId: claim.vendorId,
      before: { status: "open", claimedAmount: claim.claimedAmount },
      after: { status: decision.outcome, awardedAmount: awarded, courierId: claim.courierId, note },
    },
  );
}

/**
 * What each company owes for damage, for the people allowed to know.
 *
 * Summed over every claim rather than the page the list reads, because a
 * liability that stops counting at a hundred rows is a liability under-stated.
 */
export async function damageLedger(actor: Actor) {
  assertCan(actor, "delivery.view");
  const db = await handle();
  const scope = readableCouriers(actor);
  const rows = await db
    .select({ courierId: damageClaims.courierId, status: damageClaims.status, awardedAmount: damageClaims.awardedAmount })
    .from(damageClaims)
    .where(scope === "all" ? undefined : inArray(damageClaims.courierId, scope.length ? scope : [-1]));
  const names = new Map((await db.select({ id: couriers.id, name: couriers.name }).from(couriers)).map(row => [row.id, row.name]));
  return liabilityByCourier(rows).map(row => ({ ...row, courierName: names.get(row.courierId) ?? null }));
}

/**
 * Claims waiting on this actor, for a tile that hides at zero.
 *
 * For NetLet, every open claim — it is theirs to decide. For a delivery company,
 * the open claims against it that it has not yet answered, because that is the
 * one thing on the page that is their work. Anybody else has nothing waiting.
 */
export async function countOpenClaims(actor: Actor): Promise<number> {
  if (actor.kind !== "admin" && actor.kind !== "courier") return 0;
  const db = await handle();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(damageClaims)
    .where(and(
      eq(damageClaims.status, "open"),
      actor.kind === "courier" ? eq(damageClaims.courierId, actor.courierId) : undefined,
      actor.kind === "courier" ? isNull(damageClaims.courierResponse) : undefined,
    ));
  return row?.n ?? 0;
}
