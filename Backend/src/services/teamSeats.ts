/**
 * Which role a member of NetLet's team holds (migration 0090), read for
 * every request an administrator makes — `resolveActor` asks it, and what
 * it answers is what `can()` narrows the administrator's rights to.
 *
 * A file of its own, apart from the team's desk (`team.ts`), because
 * `inventory.ts` imports this and the desk imports `inventory.ts`.
 *
 * **It fails closed.** Before 0090 is pasted there can be no member, so a
 * missing table reads as "no seat" and every administrator keeps the full
 * rights they had. Any other failure throws, and the request fails, rather
 * than reading a member of the team as a full administrator.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { teamMembers, teamRoles, users } from "../../database/schema.js";
import { can, type Capability } from "../../../Shared/inventory/permissions.js";
import { cleanAreas, isReadyRole, type TeamSeat } from "../../../Shared/inventory/team.js";
import { isOwnerEmail } from "../core/owner.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/* Once the tables are found they stay found; while they are missing they are
   asked about again a minute later, not on every request. */
const ASK_AGAIN_MS = 60_000;
let present = false;
let checkedAt = 0;

/** Has 0090 been pasted? */
export async function teamReady(db: Db | Tx): Promise<boolean> {
  if (present) return true;
  if (checkedAt !== 0 && Date.now() - checkedAt < ASK_AGAIN_MS) return false;
  const result = await db.execute<{ ready: boolean }>(
    sql`select to_regclass('public.team_members') is not null and to_regclass('public.team_roles') is not null as ready`,
  );
  const rows = Array.isArray(result) ? result : (result as { rows: { ready: boolean }[] }).rows;
  present = Boolean(rows[0]?.ready);
  checkedAt = Date.now();
  return present;
}

/** For tests that rename the tables away and back. */
export function forgetTeamReadiness(): void {
  present = false;
  checkedAt = 0;
}

/* One read per request: tRPC hands every procedure in a batch the same
   `ctx.user`, so a page asking ten things asks this once. */
const seats = new WeakMap<object, Promise<TeamSeat | null>>();

/** The seat an administrator holds on the team, or null for a full administrator. */
export function teamSeatOf(user: { id: number; role: string }): Promise<TeamSeat | null> {
  if (user.role !== "admin") return Promise.resolve(null);
  const known = seats.get(user);
  if (known) return known;
  const pending = readSeat(user.id);
  seats.set(user, pending);
  pending.catch(() => seats.delete(user));
  return pending;
}

export async function readSeat(userId: number, db?: Db | Tx): Promise<TeamSeat | null> {
  const handle = db ?? (await getDb());
  if (!handle) return null;
  if (!(await teamReady(handle))) return null;
  const [row] = await handle
    .select({ roleId: teamRoles.id, slug: teamRoles.slug, name: teamRoles.name, nameAr: teamRoles.nameAr, areas: teamRoles.areas })
    .from(teamMembers)
    .innerJoin(teamRoles, eq(teamRoles.id, teamMembers.roleId))
    .where(eq(teamMembers.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    roleId: row.roleId,
    slug: isReadyRole(row.slug) ? row.slug : null,
    name: row.name,
    nameAr: row.nameAr,
    areas: cleanAreas(row.areas ?? []),
  };
}

/**
 * Every account on the team whose role reaches this capability, and every
 * full administrator — who a staff notice goes to. Before 0090 is pasted,
 * every administrator.
 */
export async function staffWhoCan(db: Db, capability: Capability): Promise<number[]> {
  const admins = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.role, "admin"));
  if (admins.length === 0 || !(await teamReady(db))) return admins.map(row => row.id);
  const seats = await db
    .select({ userId: teamMembers.userId, areas: teamRoles.areas })
    .from(teamMembers)
    .innerJoin(teamRoles, eq(teamRoles.id, teamMembers.roleId))
    .where(inArray(teamMembers.userId, admins.map(row => row.id)));
  const areasOf = new Map(seats.map(row => [row.userId, cleanAreas(row.areas ?? [])]));
  return admins
    .filter(admin => {
      const areas = areasOf.get(admin.id);
      if (!areas || isOwnerEmail(admin.email)) return true;
      return can({ kind: "admin", userId: admin.id, team: { roleId: 0, slug: null, name: null, nameAr: null, areas } }, capability);
    })
    .map(row => row.id);
}
