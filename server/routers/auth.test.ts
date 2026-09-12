import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context.js";
import { COOKIE_NAME } from "../../shared/const.js";
import type { User } from "../../drizzle/schema.js";

type CookieCall = { name: string; options: Record<string, unknown> };

const sampleUser: User = {
  id: 1,
  email: "sample@example.com",
  passwordHash: "scrypt$32768$8$1$c2FsdA$aGFzaA",
  name: "Sample User",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function createContext(user: User | null = null) {
  const cleared: CookieCall[] = [];
  const set: CookieCall[] = [];
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => cleared.push({ name, options }),
      cookie: (name: string, _value: string, options: Record<string, unknown>) => set.push({ name, options }),
    } as unknown as TrpcContext["res"],
  };
  return { ctx, cleared, set };
}

/** ENV snapshots process.env at import, so the router is loaded per-case. */
async function caller(ctx: TrpcContext) {
  vi.resetModules();
  const { appRouter } = await import("../routers");
  return appRouter.createCaller(ctx);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("auth.me", () => {
  it("is null for a signed-out visitor", async () => {
    const { ctx } = createContext(null);
    expect(await (await caller(ctx)).auth.me()).toBeNull();
  });

  it("never exposes the password hash", async () => {
    const { ctx } = createContext(sampleUser);
    const me = await (await caller(ctx)).auth.me();

    // The guard that matters: `users` rows carry the digest and the Firebase
    // uid, and returning the row wholesale would ship both to every browser on
    // every page load.
    expect(me).not.toHaveProperty("passwordHash");
    expect(me).not.toHaveProperty("firebaseUid");
    // Pinned rather than merely spot-checked, so a field added to `users` has
    // to be admitted here on purpose before it can reach the client. The two
    // dates were admitted for the account page, which shows when the account
    // was opened and last used.
    expect(Object.keys(me ?? {}).sort()).toEqual(
      ["createdAt", "email", "id", "lastSignedIn", "name", "role"],
    );
  });
});

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, cleared } = createContext(sampleUser);

    expect(await (await caller(ctx)).auth.logout()).toEqual({ success: true });
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.name).toBe(COOKIE_NAME);
    expect(cleared[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      // "lax", not "none": the cookie is first-party now that sign-in is in-app
      // and the site is no longer framed by an external preview.
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    });
  });
});

describe("auth without configuration", () => {
  // The server boots on an empty environment, so these must fail as a stated
  // precondition rather than as a crash or, worse, a silent success.
  it.each(["login", "register"] as const)("refuses %s when JWT_SECRET is unset", async method => {
    vi.stubEnv("JWT_SECRET", "");
    vi.stubEnv("DATABASE_URL", "");
    const { ctx } = createContext(null);
    const api = await caller(ctx);
    await expect(
      api.auth[method]({ email: "shopper@example.com", password: "a-long-enough-password" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects a password below the minimum length before touching the database", async () => {
    vi.stubEnv("JWT_SECRET", "test-secret");
    vi.stubEnv("DATABASE_URL", "mysql://unused");
    const { ctx } = createContext(null);
    const api = await caller(ctx);
    await expect(api.auth.register({ email: "shopper@example.com", password: "short" })).rejects.toThrow();
  });
});
