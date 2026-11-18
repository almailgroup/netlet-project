/**
 * NetLet's team, the database half (migration 0090). `Shared/inventory/team.ts`
 * is the rule: what a role's areas open, the seven ready-made roles, and who
 * may move whom. This file is the desk on `/admin/staff`: who is on the team
 * with which role, putting somebody on it, changing their role, taking them
 * off, and the roles themselves.
 *
 * A member is an administrator account (`users.role = 'admin'`) with a row in
 * `team_members`; an administrator with no row is a full administrator. So
 * everything an administrator is held to — an authorised device, the admin
 * portal's address, no sign-in on the shop's website — holds for a member
 * from the moment they are added, and taking them off the team makes the
 * account a shopper's again on its next request.
 *
 * **Who may** is `teamMoveRefusal`: a full administrator moves anybody but the
 * owner and themselves; a member whose role opens Team (HR, `team.manage`)
 * moves members holding a role, never a full administrator and never
 * themselves. Changing what a role opens, making a role and deleting one are a
 * full administrator's alone (`platform.manageUsers`). **The last full
 * administrator stays**: anything that would leave none is refused, counted
 * under a lock on every administrator's row, the rule `setUserAdmin` keeps.
 *
 * **Closed, not broken, until 0090 is pasted**: the desk answers
 * `ready: false` and every move refuses with `team.unavailable`, while every
 * administrator keeps the full rights they had.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { teamMembers, teamRoles, users } from "../../database/schema.js";
import { assertCan, can, fullAdmin, type Actor } from "../../../Shared/inventory/permissions.js";
import {
  cleanAreas,
  isReadyRole,
  MAX_TEAM_ROLES,
  READY_ROLE_AREAS,
  READY_ROLES,
  roleProblems,
  storedNames,
  teamMoveRefusal,
  type ReadyRole,
  type RoleProblem,
  type TeamArea,
  type TeamMove,
  type TeamRefusal,
} from "../../../Shared/inventory/team.js";
import { isOwnerEmail } from "../core/owner.js";
import { createAccount, EmailTakenError } from "../core/accounts.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { teamReady } from "./teamSeats.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type TeamDeskRefusal =
  | TeamRefusal
  | RoleProblem
  | "team.unavailable"
  | "team.noSuchAccount"
  | "team.noSuchRole"
  | "team.alreadyOn"
  | "team.notOn"
  | "team.lastFull"
  | "team.readyRoleStays"
  | "team.roleHeld"
  | "team.tooManyRoles"
  | "team.emailTaken"
  | "team.rolesFullOnly";

/** Refused for a reason the page says in words. */
export class TeamRefused extends Error {
  constructor(readonly reason: TeamDeskRefusal) {
    super(reason);
    this.name = "TeamRefused";
  }
}

async function open(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  if (!(await teamReady(db))) throw new TeamRefused("team.unavailable");
  await ensureReadyRoles(db);
  return db;
}

/* The seven ready-made roles are rows, so a member can hold one and a full
   administrator can rename it or give it other areas. Written insert-only the
   first time an instance opens the desk: a ready-made role somebody changed
   keeps the change. */
let seeded = false;
async function ensureReadyRoles(db: Db): Promise<void> {
  if (seeded) return;
  await db
    .insert(teamRoles)
    .values(READY_ROLES.map(slug => ({ slug, areas: [...READY_ROLE_AREAS[slug]] })))
    .onConflictDoNothing({ target: teamRoles.slug });
  seeded = true;
}

/** For tests that empty the tables between cases. */
export function forgetReadyRoles(): void {
  seeded = false;
}

/** Who the person acting is, as the rule asks. */
function powersOf(actor: Actor): { full: boolean; hr: boolean } {
  return { full: fullAdmin(actor), hr: actor.kind === "admin" && can(actor, "team.manage") };
}

function refuse(actor: Actor, target: { id: number; email: string | null }, move: TeamMove): void {
  const refusal = teamMoveRefusal(
    { ...powersOf(actor), targetIsSelf: target.id === actor.userId, targetIsOwner: isOwnerEmail(target.email) },
    move,
  );
  if (refusal) throw new TeamRefused(refusal);
}

/* What a role is called on the trail: the ready-made key, or the name it was given. */
function roleLabel(role: { slug: string | null; name: string | null; nameAr: string | null } | null): string {
  if (!role) return "full";
  return role.name || role.nameAr || role.slug || "role";
}

/**
 * The administrators' rows, locked, and how many of them are full
 * administrators — counted under the lock, so two moves at once that would
 * each leave one full administrator cannot both go ahead and leave none.
 */
async function fullAdminsLocked(tx: Tx): Promise<number[]> {
  const admins = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).for("update");
  if (admins.length === 0) return [];
  const seated = await tx.select({ id: teamMembers.userId }).from(teamMembers).where(inArray(teamMembers.userId, admins.map(row => row.id)));
  const taken = new Set(seated.map(row => row.id));
  return admins.map(row => row.id).filter(id => !taken.has(id));
}

async function roleById(db: Db | Tx, roleId: number) {
  const [role] = await db.select().from(teamRoles).where(eq(teamRoles.id, roleId)).limit(1);
  if (!role) throw new TeamRefused("team.noSuchRole");
  return role;
}

/* ------------------------------------------------------------- the desk --- */

export type TeamRoleView = {
  id: number;
  slug: ReadyRole | null;
  name: string | null;
  nameAr: string | null;
  areas: TeamArea[];
  members: number;
  /** A ready-made role can be renamed and given other areas, never deleted. */
  deletable: boolean;
};

export type TeamMemberView = {
  userId: number;
  name: string | null;
  email: string | null;
  /** The role held, or null for a full administrator. */
  roleId: number | null;
  owner: boolean;
  you: boolean;
  addedAt: string | null;
  addedBy: string | null;
  lastSignedIn: string | null;
  /** The buttons this person may press on this row: what the API takes from them. */
  mayChange: boolean;
  mayRemove: boolean;
  /** Whether the role may be changed to full administrator from here. */
  mayMakeFull: boolean;
};

export type TeamDesk = {
  ready: boolean;
  roles: TeamRoleView[];
  members: TeamMemberView[];
  /** Changing what a role opens, and making or deleting one: a full administrator's alone. */
  mayEditRoles: boolean;
  /** Giving somebody the full administrator's rights: a full administrator's alone. */
  mayMakeFull: boolean;
};

export async function teamDesk(actor: Actor): Promise<TeamDesk> {
  assertCan(actor, "team.manage");
  const powers = powersOf(actor);
  const db = await getDb();
  const shut: TeamDesk = { ready: false, roles: [], members: [], mayEditRoles: powers.full, mayMakeFull: powers.full };
  if (!db || !(await teamReady(db))) return shut;
  await ensureReadyRoles(db);

  const [roles, counts, admins, seats] = await Promise.all([
    db.select().from(teamRoles).orderBy(sql`${teamRoles.slug} is null`, asc(teamRoles.id)),
    db.select({ roleId: teamMembers.roleId, n: sql<number>`count(*)::int` }).from(teamMembers).groupBy(teamMembers.roleId),
    db
      .select({ id: users.id, name: users.name, email: users.email, lastSignedIn: users.lastSignedIn })
      .from(users)
      .where(eq(users.role, "admin"))
      .orderBy(asc(users.name), asc(users.id)),
    db.select({ userId: teamMembers.userId, roleId: teamMembers.roleId, addedAt: teamMembers.addedAt, addedBy: teamMembers.addedBy }).from(teamMembers),
  ]);
  const held = new Map(counts.map(row => [row.roleId, row.n]));
  const seatOf = new Map(seats.map(row => [row.userId, row]));
  const adders = [...new Set(seats.map(row => row.addedBy).filter((id): id is number => id !== null))];
  const adderNames = adders.length
    ? new Map((await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, adders))).map(row => [row.id, row.name || row.email]))
    : new Map<number, string | null>();

  const members: TeamMemberView[] = admins.map(admin => {
    const seat = seatOf.get(admin.id);
    const target = { id: admin.id, email: admin.email };
    const from = seat ? "role" : "full";
    const may = (move: TeamMove) =>
      teamMoveRefusal({ ...powers, targetIsSelf: target.id === actor.userId, targetIsOwner: isOwnerEmail(target.email) }, move) === null;
    return {
      userId: admin.id,
      name: admin.name,
      email: admin.email,
      roleId: seat?.roleId ?? null,
      owner: isOwnerEmail(admin.email),
      you: admin.id === actor.userId,
      addedAt: seat?.addedAt?.toISOString() ?? null,
      addedBy: seat?.addedBy ? adderNames.get(seat.addedBy) ?? null : null,
      lastSignedIn: admin.lastSignedIn ? new Date(admin.lastSignedIn).toISOString() : null,
      mayChange: may({ kind: "change", from, to: "role" }),
      mayRemove: may({ kind: "remove", from }),
      mayMakeFull: from === "role" && may({ kind: "change", from, to: "full" }),
    };
  });

  return {
    ready: true,
    roles: roles.map(role => ({
      id: role.id,
      slug: isReadyRole(role.slug) ? role.slug : null,
      name: role.name,
      nameAr: role.nameAr,
      areas: cleanAreas(role.areas ?? []),
      members: held.get(role.id) ?? 0,
      deletable: !role.slug && (held.get(role.id) ?? 0) === 0,
    })),
    members,
    mayEditRoles: powers.full,
    mayMakeFull: powers.full,
  };
}

/* -------------------------------------------------------- the members --- */

/** Somebody who already has an account, put on the team with a role — or as a full administrator (`roleId` null). */
export async function addToTeam(actor: Actor, input: { email: string; roleId: number | null }): Promise<{ userId: number }> {
  assertCan(actor, "team.manage");
  const db = await open();
  const email = input.email.trim().toLowerCase();
  const [target] = await db.select({ id: users.id, email: users.email, role: users.role }).from(users).where(eq(users.email, email)).limit(1);
  if (!target) throw new TeamRefused("team.noSuchAccount");
  refuse(actor, target, { kind: "add", to: input.roleId === null ? "full" : "role" });
  if (target.role === "admin") throw new TeamRefused("team.alreadyOn");
  const role = input.roleId === null ? null : await roleById(db, input.roleId);

  await db.transaction(async tx => {
    /* Read again under a lock: two people adding the same account at once put it on once. */
    const [now] = await tx.select({ role: users.role }).from(users).where(eq(users.id, target.id)).for("update");
    if (!now || now.role === "admin") throw new TeamRefused("team.alreadyOn");
    await tx.delete(teamMembers).where(eq(teamMembers.userId, target.id));
    if (role) await tx.insert(teamMembers).values({ userId: target.id, roleId: role.id, addedBy: actor.userId });
    await tx.update(users).set({ role: "admin" }).where(eq(users.id, target.id));
  });

  await recordAudit(await auditActor(actor), {
    action: "team.add",
    subjectType: "user",
    subjectId: target.id,
    subjectLabel: target.email,
    before: { role: "user" },
    after: { role: "admin", teamRole: roleLabel(role) },
  });
  return { userId: target.id };
}

/** A new account made for a new member of the team, with the password they will sign in with. */
export async function createTeamMember(
  actor: Actor,
  input: { email: string; password: string; name?: string | null; roleId: number | null },
): Promise<{ userId: number }> {
  assertCan(actor, "team.manage");
  const db = await open();
  refuse(actor, { id: -1, email: null }, { kind: "add", to: input.roleId === null ? "full" : "role" });
  const role = input.roleId === null ? null : await roleById(db, input.roleId);
  const email = input.email.trim().toLowerCase();
  /* The owner's account is a full administrator by its address (`OWNER_EMAIL`). */
  if (isOwnerEmail(email)) throw new TeamRefused("team.ownerStays");
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (taken) throw new TeamRefused("team.emailTaken");

  let account;
  try {
    account = await createAccount({ email, password: input.password, name: input.name ?? null });
  } catch (error) {
    if (error instanceof EmailTakenError) throw new TeamRefused("team.emailTaken");
    throw error;
  }
  await db.transaction(async tx => {
    if (role) await tx.insert(teamMembers).values({ userId: account.id, roleId: role.id, addedBy: actor.userId });
    await tx.update(users).set({ role: "admin" }).where(eq(users.id, account.id));
  });

  await recordAudit(await auditActor(actor), {
    action: "team.add",
    subjectType: "user",
    subjectId: account.id,
    subjectLabel: account.email,
    before: null,
    after: { role: "admin", teamRole: roleLabel(role), createdAccount: true },
  });
  return { userId: account.id };
}

/** A member's role changed — to another role, or to full administrator (`roleId` null). */
export async function setTeamRole(actor: Actor, userId: number, roleId: number | null): Promise<void> {
  assertCan(actor, "team.manage");
  const db = await open();
  const [target] = await db.select({ id: users.id, email: users.email, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target || target.role !== "admin") throw new TeamRefused("team.notOn");
  const [seat] = await db.select({ roleId: teamMembers.roleId }).from(teamMembers).where(eq(teamMembers.userId, userId)).limit(1);
  const from = seat ? "role" : "full";
  refuse(actor, target, { kind: "change", from, to: roleId === null ? "full" : "role" });
  if ((seat?.roleId ?? null) === roleId) return;
  const before = seat ? await roleById(db, seat.roleId) : null;
  const after = roleId === null ? null : await roleById(db, roleId);

  await db.transaction(async tx => {
    if (from === "full") {
      const full = await fullAdminsLocked(tx);
      if (full.length <= 1 && full.includes(userId)) throw new TeamRefused("team.lastFull");
    }
    await tx.delete(teamMembers).where(eq(teamMembers.userId, userId));
    if (after) await tx.insert(teamMembers).values({ userId, roleId: after.id, addedBy: actor.userId });
  });

  await recordAudit(await auditActor(actor), {
    action: "team.setRole",
    subjectType: "user",
    subjectId: userId,
    subjectLabel: target.email,
    before: { teamRole: roleLabel(before) },
    after: { role: "admin", teamRole: roleLabel(after) },
  });
}

/** Taken off the team: the account is a shopper's again from its next request. */
export async function removeFromTeam(actor: Actor, userId: number): Promise<void> {
  assertCan(actor, "team.manage");
  const db = await open();
  const [target] = await db.select({ id: users.id, email: users.email, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target || target.role !== "admin") throw new TeamRefused("team.notOn");
  const [seat] = await db.select({ roleId: teamMembers.roleId }).from(teamMembers).where(eq(teamMembers.userId, userId)).limit(1);
  const from = seat ? "role" : "full";
  refuse(actor, target, { kind: "remove", from });
  const before = seat ? await roleById(db, seat.roleId) : null;

  await db.transaction(async tx => {
    const full = await fullAdminsLocked(tx);
    if (from === "full" && full.length <= 1 && full.includes(userId)) throw new TeamRefused("team.lastFull");
    await tx.delete(teamMembers).where(eq(teamMembers.userId, userId));
    await tx.update(users).set({ role: "user" }).where(eq(users.id, userId));
  });

  await recordAudit(await auditActor(actor), {
    action: "team.remove",
    subjectType: "user",
    subjectId: userId,
    subjectLabel: target.email,
    before: { role: "admin", teamRole: roleLabel(before) },
    after: { role: "user" },
  });
}

/* ---------------------------------------------------------- the roles --- */

function assertRoleEditor(actor: Actor): void {
  if (!fullAdmin(actor)) throw new TeamRefused("team.rolesFullOnly");
}

function firstProblem(draft: { name: string; nameAr: string; areas: readonly unknown[] }, ready: boolean): void {
  const problems = roleProblems(draft, ready);
  const first = problems.name ?? problems.nameAr ?? problems.areas;
  if (first) throw new TeamRefused(first);
}

export async function createTeamRole(actor: Actor, input: { name: string; nameAr: string; areas: string[] }): Promise<{ id: number }> {
  assertRoleEditor(actor);
  const db = await open();
  firstProblem(input, false);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(teamRoles);
  if (n >= MAX_TEAM_ROLES) throw new TeamRefused("team.tooManyRoles");
  const names = storedNames(input);
  const areas = cleanAreas(input.areas);
  const [row] = await db.insert(teamRoles).values({ ...names, areas, createdBy: actor.userId }).returning({ id: teamRoles.id });
  await recordAudit(await auditActor(actor), {
    action: "team.role.create",
    subjectType: "teamRole",
    subjectId: row.id,
    subjectLabel: names.name ?? names.nameAr,
    before: null,
    after: { ...names, areas },
  });
  return { id: row.id };
}

export async function updateTeamRole(actor: Actor, id: number, input: { name: string; nameAr: string; areas: string[] }): Promise<void> {
  assertRoleEditor(actor);
  const db = await open();
  const was = await roleById(db, id);
  firstProblem(input, was.slug !== null);
  const names = storedNames(input);
  const areas = cleanAreas(input.areas);
  await db.update(teamRoles).set({ ...names, areas, updatedAt: new Date() }).where(eq(teamRoles.id, id));
  await recordAudit(await auditActor(actor), {
    action: "team.role.update",
    subjectType: "teamRole",
    subjectId: id,
    subjectLabel: names.name ?? names.nameAr ?? was.slug,
    before: { name: was.name, nameAr: was.nameAr, areas: cleanAreas(was.areas ?? []) },
    after: { ...names, areas },
  });
}

/** A role NetLet made, and nobody holds. A ready-made role stays, so the names members were given never vanish. */
export async function deleteTeamRole(actor: Actor, id: number): Promise<void> {
  assertRoleEditor(actor);
  const db = await open();
  const was = await roleById(db, id);
  if (was.slug) throw new TeamRefused("team.readyRoleStays");
  await db.transaction(async tx => {
    /* Asked under the role's lock: somebody given it a moment ago is a holder. */
    await tx.select({ id: teamRoles.id }).from(teamRoles).where(eq(teamRoles.id, id)).for("update");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(teamMembers).where(eq(teamMembers.roleId, id));
    if (n > 0) throw new TeamRefused("team.roleHeld");
    await tx.delete(teamRoles).where(and(eq(teamRoles.id, id)));
  });
  await recordAudit(await auditActor(actor), {
    action: "team.role.delete",
    subjectType: "teamRole",
    subjectId: id,
    subjectLabel: was.name ?? was.nameAr,
    before: { name: was.name, nameAr: was.nameAr, areas: cleanAreas(was.areas ?? []) },
    after: null,
  });
}
