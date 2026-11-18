/**
 * NetLet's team against a real Postgres (migration 0090).
 *
 * What a role opens is proved pure in `Shared/inventory/team.test.ts`. What
 * needs a database is the rest: that a member's role is what the API answers
 * them by, through the real router; that HR moves members holding a role and
 * nobody else; that the roles themselves are a full administrator's; that two
 * full administrators demoting each other at once leave one; that staff
 * notices go only where a role reaches; that the trail names who let a
 * member do what they did; and that before the paste nothing changes.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, desc, eq, sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, notifications, teamMembers, teamRoles, users, vendors, type User } from "../../database/schema.js";
import { can, type Actor } from "../../../Shared/inventory/permissions.js";
import type { TrpcContext } from "../core/context.js";

let db: ReturnType<typeof drizzle>;
let client: PGlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appRouter: any;
let team: typeof import("./team.js");
let seats: typeof import("./teamSeats.js");
let inventory: typeof import("./inventory.js");
let notices: typeof import("./notifications.js");

const people = {} as Record<"boss" | "second" | "hr" | "finance" | "catalogue" | "shopper" | "other", User>;
let acme = 0;

const contextFor = (user: User): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {}, ip: "10.0.0.1" } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});

/* The router reads `ctx.user` as the request found it; a fresh copy each call is a fresh request. */
const fresh = async (user: User): Promise<User> => (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
const callAs = async (user: User) => appRouter.createCaller(contextFor(await fresh(user)));
const actorOf = async (user: User): Promise<Actor> => inventory.resolveActor(await fresh(user));
const roleId = async (slug: string) => (await db.select({ id: teamRoles.id }).from(teamRoles).where(eq(teamRoles.slug, slug)).limit(1))[0].id;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({
    ...(await importOriginal<typeof import("./db.js")>()),
    getDb: async () => db,
  }));
  appRouter = (await import("../routes/index.js")).appRouter;
  team = await import("./team.js");
  seats = await import("./teamSeats.js");
  inventory = await import("./inventory.js");
  notices = await import("./notifications.js");
});

beforeEach(async () => {
  await db.delete(teamMembers);
  await db.delete(teamRoles);
  await db.delete(auditLog);
  await db.delete(notifications);
  await db.delete(vendors);
  await db.delete(users);
  team.forgetReadyRoles();
  seats.forgetTeamReadiness();
  const make = async (key: keyof typeof people, role: "admin" | "user") => {
    const [row] = await db.insert(users).values({ email: `${key}@team.test`, name: key, role, openId: `team-${key}` }).returning();
    people[key] = row;
  };
  await make("boss", "admin");
  await make("second", "admin");
  await make("hr", "user");
  await make("finance", "user");
  await make("catalogue", "user");
  await make("shopper", "user");
  await make("other", "user");
  const [store] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning({ id: vendors.id });
  acme = store.id;
  const boss = await actorOf(people.boss);
  /* The desk writes the ready-made roles the first time it is opened. */
  await team.teamDesk(boss);
  await team.addToTeam(boss, { email: people.hr.email!, roleId: await roleId("hr") });
  await team.addToTeam(boss, { email: people.finance.email!, roleId: await roleId("finance") });
  await team.addToTeam(boss, { email: people.catalogue.email!, roleId: await roleId("catalogue") });
});

describe("a member's role is what they are answered by", () => {
  it("reads a member's seat with the request, and a full administrator's as none", async () => {
    const finance = await actorOf(people.finance);
    expect(finance.kind).toBe("admin");
    expect(finance.kind === "admin" && finance.team?.slug).toBe("finance");
    expect(can(finance, "finance.view")).toBe(true);
    expect(can(finance, "product.edit")).toBe(false);
    const boss = await actorOf(people.boss);
    expect(boss.kind === "admin" && boss.team).toBeUndefined();
  });

  it("lets the role's desks through the real router and refuses the rest", async () => {
    const finance = await callAs(people.finance);
    await expect(finance.finance.report({})).resolves.toBeTruthy();
    await expect(finance.inventory.vendors.list({ pageSize: 10 })).resolves.toBeTruthy();
    await expect(finance.inventory.products.create({ vendorId: acme, title: "Lamp", price: "5.000" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(finance.team.desk()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(finance.inventory.audit({})).rejects.toMatchObject({ code: "FORBIDDEN" });

    const catalogue = await callAs(people.catalogue);
    await expect(catalogue.finance.report({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(catalogue.reviews.waiting()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await catalogue.reviews.waitingCount()).toBe(0);
  });

  it("takes a changed role from the next request", async () => {
    const boss = await actorOf(people.boss);
    await team.setTeamRole(boss, people.finance.id, await roleId("catalogue"));
    const finance = await callAs(people.finance);
    await expect(finance.finance.report({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("shows a store's payout account whole only to a role that edits or pays the store", async () => {
    const iban = "KW81CBKU0000000000001234560101";
    await db.update(vendors).set({ payoutIban: iban }).where(eq(vendors.id, acme));
    await team.addToTeam(await actorOf(people.boss), { email: people.other.email!, roleId: await roleId("marketing") });
    const ibanOf = async (user: User) => {
      const caller = await callAs(user);
      const one = await caller.inventory.vendors.get({ vendorId: acme });
      const listed = (await caller.inventory.vendors.list({ pageSize: 10 })).rows.find((row: { id: number }) => row.id === acme);
      expect(listed.payoutIban).toBe(one.payoutIban);
      return one.payoutIban;
    };
    /* Marketing and Catalogue open a store's page and have no use for its bank account. */
    expect(await ibanOf(people.other)).toBe("KW•••• 0101");
    expect(await ibanOf(people.catalogue)).toBe("KW•••• 0101");
    /* Finance pays it, and a full administrator edits it. */
    expect(await ibanOf(people.finance)).toBe(iban);
    expect(await ibanOf(people.boss)).toBe(iban);
  });

  it("lets a role that reads the catalogue list the bundles, and only Catalogue make NetLet's", async () => {
    /* Finance reaches Bundles through Orders' `product.view`; listing asked
       `bundles.netlet` of any administrator, so the page could not load. */
    const finance = await callAs(people.finance);
    await expect(finance.inventory.bundles.list()).resolves.toEqual([]);
    await expect(finance.inventory.bundles.save({ vendorId: null, name: "Set", bundlePrice: "5.000", members: [{ variantId: 1, quantity: 1 }, { variantId: 2, quantity: 1 }] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(can(await actorOf(people.catalogue), "bundles.netlet")).toBe(true);
    /* A shopper still reads none of it. */
    await expect((await callAs(people.shopper)).inventory.bundles.list()).resolves.toEqual([]);
  });

  it("keeps the owner a full administrator whatever a row says", async () => {
    const { ENV } = await import("../core/env.js");
    const before = ENV.ownerEmail;
    ENV.ownerEmail = people.second.email!;
    try {
      await db.insert(teamMembers).values({ userId: people.second.id, roleId: await roleId("hr") });
      const owner = await actorOf(people.second);
      expect(owner.kind === "admin" && owner.owner).toBe(true);
      expect(owner.kind === "admin" && owner.team).toBeUndefined();
      await expect(team.setTeamRole(await actorOf(people.boss), people.second.id, await roleId("finance"))).rejects.toThrow("team.ownerStays");
    } finally {
      ENV.ownerEmail = before;
    }
  });
});

describe("who may move whom", () => {
  it("lets HR put somebody on the team with a role, and nothing more", async () => {
    const hr = await actorOf(people.hr);
    await team.addToTeam(hr, { email: people.shopper.email!, roleId: await roleId("marketing") });
    const now = await fresh(people.shopper);
    expect(now.role).toBe("admin");
    const shopper = await actorOf(people.shopper);
    expect(shopper.kind === "admin" && shopper.team?.slug).toBe("marketing");

    await expect(team.addToTeam(hr, { email: people.other.email!, roleId: null })).rejects.toThrow("team.fullOnly");
    await expect(team.setTeamRole(hr, people.hr.id, await roleId("manager"))).rejects.toThrow("team.notYourself");
    await expect(team.setTeamRole(hr, people.boss.id, await roleId("finance"))).rejects.toThrow("team.fullOnly");
    await expect(team.removeFromTeam(hr, people.boss.id)).rejects.toThrow("team.fullOnly");
    await expect(team.setTeamRole(hr, people.finance.id, null)).rejects.toThrow("team.fullOnly");
  });

  it("lets HR change a member's role and take them off, which makes the account a shopper's", async () => {
    const hr = await actorOf(people.hr);
    await team.setTeamRole(hr, people.finance.id, await roleId("operations"));
    await team.removeFromTeam(hr, people.catalogue.id);
    expect((await fresh(people.catalogue)).role).toBe("user");
    expect((await actorOf(people.catalogue)).kind).toBe("customer");
    await expect(team.removeFromTeam(hr, people.catalogue.id)).rejects.toThrow("team.notOn");
  });

  it("refuses anybody whose role does not open Team", async () => {
    const finance = await actorOf(people.finance);
    await expect(team.addToTeam(finance, { email: people.shopper.email!, roleId: await roleId("finance") })).rejects.toThrow(/FORBIDDEN|team.notAllowed/);
  });

  it("makes a new account for a new member, who is on the team from the start", async () => {
    const hr = await actorOf(people.hr);
    const made = await team.createTeamMember(hr, { email: "new@team.test", password: "a sturdy password", name: "New", roleId: await roleId("customerService") });
    const member = await inventory.resolveActor((await db.select().from(users).where(eq(users.id, made.userId)))[0]);
    expect(member.kind === "admin" && member.team?.slug).toBe("customerService");
    await expect(team.createTeamMember(hr, { email: "new@team.test", password: "a sturdy password", roleId: await roleId("hr") })).rejects.toThrow("team.emailTaken");
  });

  it("leaves one full administrator when two demote each other at once", async () => {
    const boss = await actorOf(people.boss);
    const second = await actorOf(people.second);
    const finance = await roleId("finance");
    const settled = await Promise.allSettled([
      team.setTeamRole(boss, people.second.id, finance),
      team.setTeamRole(second, people.boss.id, finance),
    ]);
    expect(settled.filter(one => one.status === "fulfilled")).toHaveLength(1);
    const full = await db.execute(sql`select count(*)::int as n from users where role = 'admin' and id not in (select user_id from team_members)`);
    const rows = Array.isArray(full) ? full : (full as { rows: { n: number }[] }).rows;
    expect(rows[0].n).toBe(1);
  });

  it("makes somebody a full administrator through People, off any role they held", async () => {
    await inventory.setUserAdmin(await actorOf(people.boss), people.finance.id, true);
    const finance = await actorOf(people.finance);
    expect(finance.kind === "admin" && finance.team).toBeUndefined();
    await inventory.setUserAdmin(await actorOf(people.boss), people.hr.id, false);
    expect((await db.select().from(teamMembers).where(eq(teamMembers.userId, people.hr.id)))).toHaveLength(0);
  });
});

describe("the roles", () => {
  it("are a full administrator's to make, change and delete", async () => {
    const hr = await actorOf(people.hr);
    await expect(team.createTeamRole(hr, { name: "Buyers", nameAr: "", areas: ["catalogue"] })).rejects.toThrow("team.rolesFullOnly");
    const boss = await actorOf(people.boss);
    await expect(team.createTeamRole(boss, { name: "", nameAr: "", areas: ["catalogue"] })).rejects.toThrow("team.nameNeeded");
    await expect(team.createTeamRole(boss, { name: "Buyers", nameAr: "", areas: [] })).rejects.toThrow("team.areasNeeded");
    const { id } = await team.createTeamRole(boss, { name: "Buyers", nameAr: "المشتريات", areas: ["catalogue", "orders"] });
    await team.updateTeamRole(boss, id, { name: "Buyers", nameAr: "المشتريات", areas: ["catalogue"] });
    await team.addToTeam(boss, { email: people.shopper.email!, roleId: id });
    await expect(team.deleteTeamRole(boss, id)).rejects.toThrow("team.roleHeld");
    await team.removeFromTeam(boss, people.shopper.id);
    await team.deleteTeamRole(boss, id);
    await expect(team.deleteTeamRole(boss, await roleId("finance"))).rejects.toThrow("team.readyRoleStays");
  });

  it("change what every member holding them opens, from the next request", async () => {
    const boss = await actorOf(people.boss);
    await team.updateTeamRole(boss, await roleId("finance"), { name: "", nameAr: "", areas: ["money", "settings"] });
    const finance = await actorOf(people.finance);
    expect(can(finance, "audit.view")).toBe(true);
    expect(can(finance, "orders.view")).toBe(true); /* Money's own area reads the orders behind it. */
  });

  it("answers the desk with each row's buttons as the API would take them", async () => {
    const desk = await team.teamDesk(await actorOf(people.hr));
    expect(desk.ready).toBe(true);
    expect(desk.mayEditRoles).toBe(false);
    expect(desk.roles.map(role => role.slug).filter(Boolean)).toEqual(["manager", "finance", "hr", "customerService", "catalogue", "operations", "marketing"]);
    const row = (id: number) => desk.members.find(member => member.userId === id)!;
    expect(row(people.boss.id).mayChange).toBe(false);
    expect(row(people.hr.id).mayChange).toBe(false);
    expect(row(people.finance.id).mayChange).toBe(true);
    expect(row(people.finance.id).mayMakeFull).toBe(false);
    expect(desk.roles.find(role => role.slug === "finance")?.members).toBe(1);
  });
});

describe("the trail and the notices", () => {
  it("names who put a member on the team beside what the member then did", async () => {
    const finance = await actorOf(people.finance);
    await inventory.setVendorCommission(finance, acme, "7.50");
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, "vendor.setCommission")).orderBy(desc(auditLog.id)).limit(1);
    expect(row.actorId).toBe(people.finance.id);
    expect(row.authorisedById).toBe(people.boss.id);
    const [added] = await db.select().from(auditLog).where(and(eq(auditLog.action, "team.add"), eq(auditLog.subjectId, people.finance.id))).limit(1);
    expect(added.after).toMatchObject({ role: "admin", teamRole: "finance" });
  });

  it("sends a staff notice only where a role reaches", async () => {
    await notices.notifyStaff({ kind: "staff_fraud_referral", link: "/admin/fraud", dedupe: "fraud:referral:1" }, "fraud.view");
    const told = (await db.select({ userId: notifications.userId }).from(notifications)).map(row => row.userId).sort();
    expect(told).toEqual([people.boss.id, people.second.id].sort());
    await notices.notifyStaff({ kind: "staff_listing_flagged", params: { product: "Lamp", store: "Acme" }, link: "/admin/review", dedupe: "listing:1" }, "product.review");
    const flagged = (await db.select({ userId: notifications.userId }).from(notifications).where(eq(notifications.kind, "staff_listing_flagged"))).map(row => row.userId).sort();
    expect(flagged).toEqual([people.boss.id, people.second.id, people.catalogue.id].sort());
  });
});

describe("before 0090 is pasted", () => {
  it("reads every administrator as full and closes the desk", async () => {
    await client.exec(`alter table team_members rename to team_members_away; alter table team_roles rename to team_roles_away;`);
    seats.forgetTeamReadiness();
    try {
      const finance = await actorOf(people.finance);
      expect(finance.kind === "admin" && finance.team).toBeUndefined();
      const desk = await team.teamDesk(await actorOf(people.boss));
      expect(desk.ready).toBe(false);
      await expect(team.addToTeam(await actorOf(people.boss), { email: people.shopper.email!, roleId: null })).rejects.toThrow("team.unavailable");
    } finally {
      await client.exec(`alter table team_members_away rename to team_members; alter table team_roles_away rename to team_roles;`);
      seats.forgetTeamReadiness();
    }
  });
});
