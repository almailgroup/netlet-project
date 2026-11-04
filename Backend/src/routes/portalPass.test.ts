/**
 * Signing in on the shop and landing signed in on a portal's own address,
 * through the router, against a real Postgres.
 *
 * Each address keeps its own session cookie (`Shared/portal.ts`), so the shop
 * hands somebody who belongs on a portal a pass, and the portal spends it
 * once. What must hold: only the portal they belong on takes it, only once,
 * only while it is fresh, and never for an account whose rights have gone.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../../../Shared/const.js";
import { users, vendorMembers, vendors } from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";
import type { User } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
const PASSWORD = "a-long-enough-password";
let serial = 0;

type Cookie = { name: string; value: string };

function contextAt(host: string, user: User | null = null, cookies: Cookie[] = []): TrpcContext {
  return {
    user,
    req: { protocol: "https", hostname: host.replace(/:\d+$/, ""), headers: { host } } as unknown as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string) => { cookies.push({ name, value }); },
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

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
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost:5432/unused");
  vi.useRealTimers();
});

async function account(role: "user" | "admin" = "user") {
  const { hashPassword } = await import("../core/password.js");
  serial += 1;
  const [row] = await db
    .insert(users)
    .values({ email: `pass${serial}@example.com`, passwordHash: await hashPassword(PASSWORD), name: "Pass Holder", role })
    .returning();
  return row as User;
}

async function storeOwner() {
  const user = await account();
  serial += 1;
  const [store] = await db.insert(vendors).values({ slug: `pass-store-${serial}`, name: `Store ${serial}`, status: "approved" }).returning();
  await db.insert(vendorMembers).values({ vendorId: store.id, userId: user.id, role: "owner" });
  return user;
}

/** Signs in on `host` asking for a pass, and returns the answer. */
async function signInAt(host: string, user: User, remember = true) {
  return appRouter.createCaller(contextAt(host)).auth.login({ email: user.email!, password: PASSWORD, remember, portal: true });
}

const passIn = (url: string) => decodeURIComponent(/#pass=(.+)$/.exec(url)?.[1] ?? "");

describe("the shop hands a sign-in on to the portal", () => {
  it("hands an administrator a pass for admin.<domain>, and a shopper none", async () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    const admin = await account("admin");
    const answer = await signInAt("netlet.net", admin);
    expect(answer.portal?.side).toBe("admin");
    expect(answer.portal?.url).toMatch(/^https:\/\/admin\.netlet\.net\/signin\?next=%2Fadmin#pass=.{40,}$/);

    const shopper = await account();
    expect((await signInAt("netlet.net", shopper)).portal).toBeNull();
  });

  it("hands a store's owner a pass for vendor.<domain>", async () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    const owner = await storeOwner();
    expect((await signInAt("netlet.net", owner)).portal?.url).toMatch(/^https:\/\/vendor\.netlet\.net\//);
  });

  it("hands nothing while the portals have no addresses, and nothing on the portal itself", async () => {
    const admin = await account("admin");
    expect((await signInAt("netlet.net", admin)).portal).toBeNull();
    expect((await signInAt("admin.netlet.net", admin)).portal).toBeNull();
  });

  it("keeps the scheme and port the request came in on", async () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.localhost");
    const admin = await account("admin");
    const ctx = contextAt("netlet.localhost:5077");
    (ctx.req as { protocol: string }).protocol = "http";
    const answer = await appRouter.createCaller(ctx).auth.login({ email: admin.email!, password: PASSWORD, portal: true });
    expect(answer.portal?.url).toMatch(/^http:\/\/admin\.netlet\.localhost:5077\/signin/);
  });
});

describe("the portal spends a pass", () => {
  it("signs the account in on the portal it was made for, once", async () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    const admin = await account("admin");
    const pass = passIn((await signInAt("netlet.net", admin)).portal.url);

    const cookies: Cookie[] = [];
    const signedIn = await appRouter.createCaller(contextAt("admin.netlet.net", null, cookies)).auth.portalHandoff({ pass });
    expect(signedIn.id).toBe(admin.id);
    expect(cookies.map(cookie => cookie.name)).toEqual([COOKIE_NAME]);

    await expect(appRouter.createCaller(contextAt("admin.netlet.net")).auth.portalHandoff({ pass })).rejects.toThrow("auth.portalPassRefused");
  });

  it("is spent on its own portal only", async () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    const admin = await account("admin");
    const pass = passIn((await signInAt("netlet.net", admin)).portal.url);
    for (const host of ["vendor.netlet.net", "netlet.net", "admin.example.com"]) {
      await expect(appRouter.createCaller(contextAt(host)).auth.portalHandoff({ pass })).rejects.toThrow("auth.portalPassRefused");
    }
    // Not spent by those refusals: its own portal still takes it.
    expect((await appRouter.createCaller(contextAt("admin.netlet.net")).auth.portalHandoff({ pass })).id).toBe(admin.id);
  });

  it("works on a portal address when the setting was never made", async () => {
    const owner = await storeOwner();
    const pass = passIn((await appRouter.createCaller(contextAt("admin.netlet.net", owner)).auth.portalPass({ next: "/admin/orders" })).url);
    expect(pass.length).toBeGreaterThan(40);
    expect((await appRouter.createCaller(contextAt("vendor.netlet.net")).auth.portalHandoff({ pass })).id).toBe(owner.id);
  });

  it("names the page to land on, and only a portal page", async () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    const owner = await storeOwner();
    const caller = appRouter.createCaller(contextAt("netlet.net", owner));
    expect((await caller.auth.portalPass({ next: "/admin/orders?tab=open" })).url).toContain("?next=%2Fadmin%2Forders%3Ftab%3Dopen#pass=");
    expect((await caller.auth.portalPass({ next: "https://evil.example/" })).url).toContain("?next=%2Fadmin#pass=");
  });

  it("refuses a pass after its minute", async () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    const admin = await account("admin");
    const pass = passIn((await signInAt("netlet.net", admin)).portal.url);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
    await expect(appRouter.createCaller(contextAt("admin.netlet.net")).auth.portalHandoff({ pass })).rejects.toThrow("auth.portalPassRefused");
  });

  it("refuses an account whose rights went in the meantime", async () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    const admin = await account("admin");
    const pass = passIn((await signInAt("netlet.net", admin)).portal.url);
    await db.update(users).set({ role: "user" }).where(eq(users.id, admin.id));
    await expect(appRouter.createCaller(contextAt("admin.netlet.net")).auth.portalHandoff({ pass })).rejects.toThrow("auth.portalPassRefused");
  });

  it("refuses a session token, a forged pass and nonsense", async () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    const admin = await account("admin");
    const { signSession } = await import("../core/auth.js");
    const session = await signSession(admin.id);
    const real = passIn((await signInAt("netlet.net", admin)).portal.url);
    const [head, body] = real.split(".");
    for (const pass of [session, `${head}.${body}.${"A".repeat(43)}`, "x".repeat(60)]) {
      await expect(appRouter.createCaller(contextAt("admin.netlet.net")).auth.portalHandoff({ pass })).rejects.toThrow("auth.portalPassRefused");
    }
  });

  it("carries whether the shop's sign-in was to be remembered", async () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    const admin = await account("admin");
    const pass = passIn((await signInAt("netlet.net", admin, false)).portal.url);
    const set: Array<{ name: string; options?: Record<string, unknown> }> = [];
    const ctx = contextAt("admin.netlet.net");
    (ctx.res as unknown as { cookie: (name: string, value: string, options: Record<string, unknown>) => void }).cookie = (name, _value, options) => { set.push({ name, options }); };
    await appRouter.createCaller(ctx).auth.portalHandoff({ pass });
    expect(set[0]?.options?.maxAge).toBeUndefined();
  });
});
