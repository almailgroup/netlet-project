/**
 * NetLet membership (4.1), the database half. The rules — who is a member,
 * what a member pays, what a waived delivery records — are
 * `Shared/commerce/membership.ts`.
 *
 * Granting is NetLet's alone (`membership.manage`): until payments exist it is
 * the only way in, and it is NetLet spending its own money on somebody's
 * delivery. A shopper reads only their own membership.
 */
import { and, desc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import { memberships, membershipTerms, orders, users } from "../drizzle/schema.js";
import { MAX_GRANT_NOTE, grantWindow, memberUntil, validMonths, type MembershipRow } from "../Shared/commerce/membership.js";
import { assertCan, type Actor } from "../Shared/inventory/permissions.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../Shared/pagination.js";
import { KUWAIT_OFFSET_MS } from "../Shared/kuwaitDay.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type MembershipRefusal = "membership.noSuchAccount" | "membership.badMonths" | "membership.notFound" | "membership.badAmount";

export class MembershipRefused extends Error {
  constructor(readonly reason: MembershipRefusal) {
    super(reason);
    this.name = "MembershipRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

async function rowsFor(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], userId: number): Promise<MembershipRow[]> {
  return db
    .select({ id: memberships.id, startsAt: memberships.startsAt, endsAt: memberships.endsAt, cancelledAt: memberships.cancelledAt })
    .from(memberships)
    .where(eq(memberships.userId, userId));
}

/** Whether this account is a member right now. Asked by checkout, the bag and the board's freeze. */
export async function isMemberNow(db: Db, userId: number | null, now = new Date()): Promise<boolean> {
  if (userId === null) return false;
  return memberUntil(await rowsFor(db, userId), now) !== null;
}

/** The programme's one setting: where a member's free delivery starts. Null is every order. */
export async function freeDeliveryOver(db: Db): Promise<string | null> {
  const [row] = await db.select({ over: membershipTerms.freeDeliveryOver }).from(membershipTerms).where(eq(membershipTerms.id, 1)).limit(1);
  return row?.over ?? null;
}

export type MyMembership = { member: boolean; until: Date | null; freeDeliveryOver: string | null };

/** The shopper's own membership, for the account page. Nothing about a non-member's history leaks: it is "not a member". */
export async function myMembership(userId: number, now = new Date()): Promise<MyMembership> {
  const db = await handle();
  const until = memberUntil(await rowsFor(db, userId), now);
  return { member: until !== null, until, freeDeliveryOver: until ? await freeDeliveryOver(db) : null };
}

/**
 * Grant a membership by email, for whole months, queued after whatever the
 * account already has so a second grant extends rather than overlaps. Under a
 * lock on the account's row, so two grants pressed at once queue rather than
 * both starting today.
 */
export async function grantMembership(actor: Actor, input: { email: string; months: number; note?: string | null }, now = new Date()): Promise<{ id: number; startsAt: Date; endsAt: Date }> {
  assertCan(actor, "membership.manage");
  if (!validMonths(input.months)) throw new MembershipRefused("membership.badMonths");
  const db = await handle();
  return db.transaction(async tx => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email.trim().toLowerCase())).limit(1).for("update");
    if (!user) throw new MembershipRefused("membership.noSuchAccount");
    const window = grantWindow(await rowsFor(tx, user.id), input.months, now);
    const [row] = await tx
      .insert(memberships)
      .values({ userId: user.id, ...window, source: "granted", grantedBy: actor.userId, note: input.note?.trim().slice(0, MAX_GRANT_NOTE) || null, createdAt: now })
      .returning({ id: memberships.id, startsAt: memberships.startsAt, endsAt: memberships.endsAt });
    return row;
  });
}

/** End a grant now. Orders already placed keep their member price and free delivery — they were frozen. */
export async function endMembership(actor: Actor, id: number, now = new Date()): Promise<void> {
  assertCan(actor, "membership.manage");
  const db = await handle();
  const [row] = await db
    .update(memberships)
    .set({ cancelledAt: now })
    .where(and(eq(memberships.id, id), isNull(memberships.cancelledAt)))
    .returning({ id: memberships.id });
  if (!row) throw new MembershipRefused("membership.notFound");
}

export type MembershipListRow = { id: number; email: string; startsAt: Date; endsAt: Date; cancelledAt: Date | null; source: string; note: string | null; active: boolean };

/** Every grant, newest first, paged; `current` narrows to the ones not yet over. */
export async function listMemberships(actor: Actor, request: { current?: boolean; page?: number; pageSize?: number } = {}, now = new Date()): Promise<Page<MembershipListRow>> {
  assertCan(actor, "membership.manage");
  const db = await handle();
  const where = request.current ? and(isNull(memberships.cancelledAt), gte(memberships.endsAt, now)) : undefined;
  const pageSize = clampPageSize(request.pageSize ?? 25);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(memberships).where(where);
  const page = clampPage(request.page ?? 1, total, pageSize);
  const rows = await db
    .select({ row: memberships, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(where)
    .orderBy(desc(memberships.createdAt), desc(memberships.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));
  return {
    rows: rows.map(({ row, email }) => ({
      id: row.id,
      email,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      cancelledAt: row.cancelledAt,
      source: row.source,
      note: row.note,
      active: row.cancelledAt === null && row.startsAt <= now && now < row.endsAt,
    })),
    total,
    page,
    pageSize,
  };
}

export async function getTerms(actor: Actor): Promise<{ freeDeliveryOver: string | null }> {
  assertCan(actor, "membership.manage");
  return { freeDeliveryOver: await freeDeliveryOver(await handle()) };
}

/** Set where free delivery starts; blank is every order. */
export async function setTerms(actor: Actor, input: { freeDeliveryOver: string | null }): Promise<void> {
  assertCan(actor, "membership.manage");
  if (input.freeDeliveryOver !== null && !/^\d{1,9}(\.\d{1,3})?$/.test(input.freeDeliveryOver)) throw new MembershipRefused("membership.badAmount");
  const db = await handle();
  await db
    .insert(membershipTerms)
    .values({ id: 1, freeDeliveryOver: input.freeDeliveryOver, updatedBy: actor.userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: membershipTerms.id, set: { freeDeliveryOver: input.freeDeliveryOver, updatedBy: actor.userId, updatedAt: new Date() } });
}

/**
 * What the programme is costing, this calendar month (UTC, like the finance
 * panel): how many members there are now, how many orders they placed, and
 * the delivery NetLet carried for them.
 */
export async function programmeReport(actor: Actor, now = new Date()): Promise<{ members: number; orders: number; waived: string }> {
  assertCan(actor, "membership.manage");
  const db = await handle();
  const [{ members }] = await db
    .select({ members: sql<number>`count(distinct ${memberships.userId})::int` })
    .from(memberships)
    .where(and(isNull(memberships.cancelledAt), lte(memberships.startsAt, now), gt(memberships.endsAt, now)));
  /* This month as Kuwait counts it: the first starts at 9pm UTC the night before. */
  const local = new Date(now.getTime() + KUWAIT_OFFSET_MS);
  const monthStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - KUWAIT_OFFSET_MS);
  const [sums] = await db
    .select({ orders: sql<number>`count(*)::int`, waived: sql<string>`coalesce(sum(${orders.deliveryWaived}), 0)::numeric(12,3)::text` })
    .from(orders)
    .where(and(eq(orders.member, true), gte(orders.placedAt, monthStart)));
  return { members, orders: sums?.orders ?? 0, waived: sums?.waived ?? "0.000" };
}
