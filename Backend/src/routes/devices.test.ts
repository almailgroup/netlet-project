/**
 * Authorised devices for NetLet Admin, through the router, against a real
 * Postgres (`Shared/auth/adminDevice.ts`).
 *
 * What must hold, on the owner's word ("only authorised devices get access to
 * the admin panel … under my control"): an administrator's rights — and an
 * employee's grant — hold only on a device the owner authorised, on every
 * address; a password alone opens nothing; the owner's first device gets in
 * by the emailed code; only the owner, on an authorised device, decides any
 * device; removing one ends its rights on the next request; a device turned
 * down cannot keep asking; and with the table missing nothing is authorised.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDevices, auditLog, notifications, staffGrants, users, type User } from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";
import { DEVICE_COOKIE, DEVICE_HEADER } from "../../../Shared/auth/adminDevice.js";
import { can } from "../../../Shared/inventory/permissions.js";
import { portalSideFor } from "../../../Shared/portal.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
let gate: typeof import("../services/adminDevices.js");
let actorOf: typeof import("../services/inventory.js")["resolveActor"];
let env: typeof import("../core/env.js")["ENV"];
const PASSWORD = "a-long-enough-password";
let serial = 0;

type Cookie = { name: string; value: string };

/** One browser or app install: its address, what it says it is, and the cookies it was handed. */
function deviceAt(host: string, options: { header?: string; ua?: string } = {}) {
  const cookies: Cookie[] = [];
  return {
    cookies,
    secret: () => cookies.filter(cookie => cookie.name === DEVICE_COOKIE).at(-1)?.value ?? options.header ?? null,
    req(): TrpcContext["req"] {
      const jar = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
      return {
        protocol: "https",
        hostname: host,
        ip: "10.9.0.1",
        headers: {
          host,
          "user-agent": options.ua ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          ...(jar ? { cookie: jar } : {}),
          ...(options.header ? { [DEVICE_HEADER]: options.header } : {}),
        },
      } as unknown as TrpcContext["req"];
    },
    res(): TrpcContext["res"] {
      return { cookie: (name: string, value: string) => { cookies.push({ name, value }); }, clearCookie: () => {} } as unknown as TrpcContext["res"];
    },
  };
}

type Device = ReturnType<typeof deviceAt>;

/** What a request from this device makes of this account — `authenticateRequest`'s gate. */
async function asSeenFrom(device: Device, user: User) {
  return gate.gateAdminRights(user, device.req() as never);
}

async function callerFrom(device: Device, user: User | null) {
  const seen = user ? await asSeenFrom(device, user) : null;
  return appRouter.createCaller({ user: seen, req: device.req(), res: device.res() });
}

async function account(role: "user" | "admin" = "user", email?: string): Promise<User> {
  const { hashPassword } = await import("../core/password.js");
  serial += 1;
  const [row] = await db
    .insert(users)
    .values({ email: email ?? `device${serial}@example.com`, passwordHash: await hashPassword(PASSWORD), name: `Person ${serial}`, role })
    .returning();
  return row as User;
}

/** The code the owner is emailed, read off the log where no mail service is configured. */
async function emailedCode(send: () => Promise<unknown>): Promise<string> {
  const said: string[] = [];
  const spy = vi.spyOn(console, "info").mockImplementation((line: unknown) => { said.push(String(line)); });
  try {
    await send();
  } finally {
    spy.mockRestore();
  }
  const code = /admin-device code for .* is (\d{6})/.exec(said.join("\n"))?.[1];
  if (!code) throw new Error(`no code was written: ${said.join(" | ")}`);
  return code;
}

let owner: User;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("../services/db", async importOriginal => {
    const actual = await importOriginal<typeof import("../services/db")>();
    return { ...actual, getDb: async () => db, touchLastSignedIn: async () => {} };
  });
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost:5432/unused");
  ({ appRouter } = await import("./index.js"));
  gate = await import("../services/adminDevices.js");
  ({ resolveActor: actorOf } = await import("../services/inventory.js"));
  ({ ENV: env } = await import("../core/env.js"));
  env.ownerEmail = "owner@netlet.test";
  owner = await account("admin", "owner@netlet.test");
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost:5432/unused");
});

/** The owner, on a device of their own authorised by the emailed code. */
async function ownersDevice(): Promise<Device> {
  const device = deviceAt("admin.netlet.test");
  await appRouter.createCaller({ user: null, req: device.req(), res: device.res() }).auth.login({ email: owner.email, password: PASSWORD });
  const caller = await callerFrom(device, owner);
  const code = await emailedCode(() => caller.devices.codeStart());
  expect(await caller.devices.codeVerify({ code })).toEqual({ access: "trusted" });
  return device;
}

describe("an administrator's rights hold only on an authorised device", () => {
  it("reads an administrator on any other device as a shopper", async () => {
    const admin = await account("admin");
    const shop = deviceAt("netlet.test");
    const seen = await asSeenFrom(shop, admin);
    expect(seen.role).toBe("user");
    const actor = await actorOf(seen);
    expect(actor).toMatchObject({ kind: "customer", adminLocked: true });
    expect(can(actor, "platform.viewAll")).toBe(false);
    // Still belongs on the admin portal, which is where the device is authorised.
    expect(portalSideFor(actor)).toBe("admin");
    await expect((await callerFrom(shop, admin)).devices.desk()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("asks for the device at sign-in on the admin portal, keeps its secret and tells the owner", async () => {
    const admin = await account("admin");
    const laptop = deviceAt("admin.netlet.test");
    await appRouter.createCaller({ user: null, req: laptop.req(), res: laptop.res() }).auth.login({ email: admin.email, password: PASSWORD });
    expect(laptop.secret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const access = await (await callerFrom(laptop, admin)).devices.access();
    expect(access).toMatchObject({ signedIn: true, applies: true, access: "pending", owner: false, deviceName: "Chrome on Windows" });
    // Still a shopper while it waits.
    expect((await asSeenFrom(laptop, admin)).role).toBe("user");
    const told = await db.select().from(notifications).where(and(eq(notifications.userId, owner.id), eq(notifications.kind, "staff_device_request")));
    expect(told.some(notice => notice.params.account === admin.email)).toBe(true);
    const [trail] = await db.select().from(auditLog).where(and(eq(auditLog.action, "admin.signIn"), eq(auditLog.actorId, admin.id)));
    expect(trail.after).toMatchObject({ deviceAccess: "pending", device: "Chrome on Windows" });
    // Signing in again on the same device asks nothing new.
    await appRouter.createCaller({ user: null, req: laptop.req(), res: laptop.res() }).auth.login({ email: admin.email, password: PASSWORD });
    expect(await db.select().from(adminDevices).where(eq(adminDevices.userId, admin.id))).toHaveLength(1);
  });

  it("keeps no secret and asks nothing for a sign-in on the shop's own address", async () => {
    const admin = await account("admin");
    const shop = deviceAt("netlet.test");
    await appRouter.createCaller({ user: null, req: shop.req(), res: shop.res() }).auth.login({ email: admin.email, password: PASSWORD });
    expect(shop.cookies.some(cookie => cookie.name === DEVICE_COOKIE)).toBe(false);
    expect(await db.select().from(adminDevices).where(eq(adminDevices.userId, admin.id))).toHaveLength(0);
  });

  it("takes the app's own secret from its header, and sets no cookie", async () => {
    const admin = await account("admin");
    const secret = "A".repeat(20) + "b".repeat(23);
    const phone = deviceAt("netlet.test", { header: secret, ua: "NetLet/40 CFNetwork/1568 Darwin/25.0.0" });
    await appRouter.createCaller({ user: null, req: phone.req(), res: phone.res() }).auth.login({ email: admin.email, password: PASSWORD });
    expect(phone.cookies.some(cookie => cookie.name === DEVICE_COOKIE)).toBe(false);
    const [row] = await db.select().from(adminDevices).where(eq(adminDevices.userId, admin.id));
    expect(row).toMatchObject({ tokenHash: gate.hashDeviceToken(secret), status: "pending", name: "NetLet app on iPhone" });
  });
});

describe("the owner decides", () => {
  it("lets the owner's first device in with the emailed code, and no other way", async () => {
    const device = deviceAt("admin.netlet.test");
    await appRouter.createCaller({ user: null, req: device.req(), res: device.res() }).auth.login({ email: owner.email, password: PASSWORD });
    const caller = await callerFrom(device, owner);
    expect(await caller.devices.access()).toMatchObject({ access: "pending", owner: true });
    // Not the desk: on a device not yet authorised the owner is a shopper too.
    await expect(caller.devices.desk()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.devices.codeVerify({ code: "000000" })).rejects.toMatchObject({ message: "auth.codeWrong" });
    const code = await emailedCode(() => caller.devices.codeStart());
    await caller.devices.codeVerify({ code });
    const seen = await asSeenFrom(device, owner);
    expect(seen.role).toBe("admin");
    expect(await actorOf(seen)).toEqual({ kind: "admin", userId: owner.id, owner: true });
    const desk = await (await callerFrom(device, owner)).devices.desk();
    expect(desk.devices.find((row: { current: boolean }) => row.current)).toMatchObject({ status: "approved", approvedHow: "email-code", owner: true });
  });

  it("will not email a code to anybody but the owner", async () => {
    const admin = await account("admin");
    const laptop = deviceAt("admin.netlet.test");
    await appRouter.createCaller({ user: null, req: laptop.req(), res: laptop.res() }).auth.login({ email: admin.email, password: PASSWORD });
    const caller = await callerFrom(laptop, admin);
    await expect(caller.devices.codeStart()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.devices.codeVerify({ code: "123456" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("approves, and later removes, another administrator's device", async () => {
    const ownerDevice = await ownersDevice();
    const admin = await account("admin");
    const laptop = deviceAt("admin.netlet.test");
    await appRouter.createCaller({ user: null, req: laptop.req(), res: laptop.res() }).auth.login({ email: admin.email, password: PASSWORD });
    const desk = await (await callerFrom(ownerDevice, owner)).devices.desk();
    const waiting = desk.devices.find((row: { userId: number; status: string }) => row.userId === admin.id && row.status === "pending");
    expect(waiting).toMatchObject({ account: admin.email, name: "Chrome on Windows", requestedIp: "10.9.0.1" });

    await (await callerFrom(ownerDevice, owner)).devices.decide({ id: waiting.id, decision: "approve" });
    const seen = await asSeenFrom(laptop, admin);
    expect(seen.role).toBe("admin");
    expect(can(await actorOf(seen), "platform.viewAll")).toBe(true);
    // An administrator who is not the owner never reaches the desk.
    await expect((await callerFrom(laptop, admin)).devices.desk()).rejects.toMatchObject({ code: "FORBIDDEN" });

    await (await callerFrom(ownerDevice, owner)).devices.rename({ id: waiting.id, name: "  Office   PC " });
    await (await callerFrom(ownerDevice, owner)).devices.decide({ id: waiting.id, decision: "revoke" });
    expect((await asSeenFrom(laptop, admin)).role).toBe("user");
    expect(await (await callerFrom(laptop, admin)).devices.access()).toMatchObject({ access: "revoked", deviceName: "Office PC" });
    const actions = (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, waiting.id))).map(row => row.action);
    expect(actions).toEqual(expect.arrayContaining(["device.request", "device.approve", "device.rename", "device.revoke"]));
    // Twice is refused rather than written twice.
    await expect((await callerFrom(ownerDevice, owner)).devices.decide({ id: waiting.id, decision: "revoke" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps a device it turned down from asking again until it is allowed", async () => {
    const ownerDevice = await ownersDevice();
    const admin = await account("admin");
    const laptop = deviceAt("admin.netlet.test");
    const signIn = () => appRouter.createCaller({ user: null, req: laptop.req(), res: laptop.res() }).auth.login({ email: admin.email, password: PASSWORD });
    await signIn();
    const [row] = await db.select().from(adminDevices).where(eq(adminDevices.userId, admin.id));
    await (await callerFrom(ownerDevice, owner)).devices.decide({ id: row.id, decision: "deny" });
    const before = await db.select().from(notifications).where(eq(notifications.kind, "staff_device_request"));
    await signIn();
    await (await callerFrom(laptop, admin)).devices.request();
    expect(await (await callerFrom(laptop, admin)).devices.access()).toMatchObject({ access: "denied" });
    expect(await db.select().from(notifications).where(eq(notifications.kind, "staff_device_request"))).toHaveLength(before.length);
    // The owner can allow it again.
    await (await callerFrom(ownerDevice, owner)).devices.decide({ id: row.id, decision: "approve" });
    expect((await asSeenFrom(laptop, admin)).role).toBe("admin");
  });
});

describe("a granted employee", () => {
  it("has the grant only on an authorised device", async () => {
    const ownerDevice = await ownersDevice();
    const employee = await account("user");
    await db.insert(staffGrants).values({ userId: employee.id, capability: "vendor.setCommission", grantedBy: owner.id });
    const laptop = deviceAt("admin.netlet.test");
    await appRouter.createCaller({ user: null, req: laptop.req(), res: laptop.res() }).auth.login({ email: employee.email, password: PASSWORD });
    const locked = await actorOf(await asSeenFrom(laptop, employee));
    expect(locked).toMatchObject({ kind: "customer", adminLocked: true });
    expect(can(locked, "vendor.setCommission")).toBe(false);
    const [row] = await db.select().from(adminDevices).where(eq(adminDevices.userId, employee.id));
    await (await callerFrom(ownerDevice, owner)).devices.decide({ id: row.id, decision: "approve" });
    expect(can(await actorOf(await asSeenFrom(laptop, employee)), "vendor.setCommission")).toBe(true);
  });
});

describe("it fails closed, and can be switched off", () => {
  it("leaves rights alone with ADMIN_DEVICES=off", async () => {
    vi.stubEnv("ADMIN_DEVICES", "off");
    const admin = await account("admin");
    expect((await asSeenFrom(deviceAt("netlet.test"), admin)).role).toBe("admin");
  });

  it("leaves rights alone with no owner to decide", async () => {
    const admin = await account("admin");
    env.ownerEmail = "";
    try {
      expect((await asSeenFrom(deviceAt("netlet.test"), admin)).role).toBe("admin");
    } finally {
      env.ownerEmail = "owner@netlet.test";
    }
  });

  it("authorises nothing while the table is missing, and says so", async () => {
    const ownerDevice = await ownersDevice();
    await db.execute(sql`alter table admin_devices rename to admin_devices_away`);
    try {
      expect((await asSeenFrom(ownerDevice, owner)).role).toBe("user");
      expect(await (await callerFrom(ownerDevice, owner)).devices.access()).toMatchObject({ access: "closed" });
      // Signing in still works; the device simply carries nothing.
      await appRouter.createCaller({ user: null, req: ownerDevice.req(), res: ownerDevice.res() }).auth.login({ email: owner.email, password: PASSWORD });
    } finally {
      await db.execute(sql`alter table admin_devices_away rename to admin_devices`);
    }
  });

  it("knows a signed-out browser that carries an authorised device, and no other", async () => {
    const ownerDevice = await ownersDevice();
    expect(await appRouter.createCaller({ user: null, req: ownerDevice.req(), res: ownerDevice.res() }).devices.access()).toEqual({ signedIn: false, rule: true, known: true });
    const stranger = deviceAt("admin.netlet.test");
    expect(await appRouter.createCaller({ user: null, req: stranger.req(), res: stranger.res() }).devices.access()).toEqual({ signedIn: false, rule: true, known: false });
  });
});
