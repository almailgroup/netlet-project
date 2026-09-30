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

    // The guard that matters: `users` rows carry the digest and the provider's
    // uid, and returning the row wholesale would ship both to every browser on
    // every page load.
    expect(me).not.toHaveProperty("passwordHash");
    expect(me).not.toHaveProperty("supabaseUid");
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

/**
 * Registration and sign-in with Supabase Auth as the password store.
 *
 * Through the router rather than through `passwordStore` directly, because the
 * things worth pinning here are the router's: that a registration hands back a
 * session cookie and a user carrying neither a hash nor a store's uid, and that
 * a wrong password is `UNAUTHORIZED` with a message key rather than whatever the
 * service said.
 */
describe("auth with Supabase Auth as the password store", () => {
  const supabaseUser = {
    ...sampleUser,
    id: 42,
    email: "supa@example.com",
    passwordHash: null,
    firebaseUid: null,
    supabaseUid: "b7f1e0c2-0000-4000-8000-000000000001",
  } as User;

  /** The store, stubbed: what it answers is its own test's business. */
  function stubStore(over: Partial<Record<string, unknown>> = {}) {
    vi.doMock("../_core/passwordStore.js", () => ({
      EmailTakenError: class EmailTakenError extends Error {},
      activeStore: () => "supabase",
      storeFor: () => "supabase",
      isUsable: () => true,
      createLogin: async () => supabaseUser,
      signIn: async (_email: string, password: string) =>
        password === "Harbour-Falcon-2026" ? supabaseUser : null,
      verifyCurrent: async () => true,
      setPassword: async () => {},
      setEmail: async () => {},
      revertEmail: async () => {},
      setDisplayName: async () => {},
      sendReset: async () => {},
      canSendReset: () => true,
      deleteLogin: async () => {},
      ...over,
    }));
    vi.doMock("../_core/accounts.js", async () => {
      const store = await import("../_core/passwordStore.js");
      return { createAccount: store.createLogin, EmailTakenError: store.EmailTakenError };
    });
    vi.doMock("../rateLimit.js", () => ({
      checkAuthAllowed: async () => ({ allowed: true }),
      recordAuthAttempt: async () => {},
      clearAccountFailures: async () => {},
    }));
    vi.doMock("../db.js", () => ({ touchLastSignedIn: async () => {} }));
    vi.doMock("../referral.js", () => ({ recordReferral: async () => {} }));
  }

  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "test-secret");
    vi.stubEnv("DATABASE_URL", "postgres://unused");
    vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  });

  it("registers and sets the session cookie", async () => {
    stubStore();
    const { ctx, set } = createContext(null);
    const api = await caller(ctx);

    const user = await api.auth.register({ email: "supa@example.com", password: "Harbour-Falcon-2026" });
    expect(user).toMatchObject({ id: 42, email: "supa@example.com" });
    expect(set.map(entry => entry.name)).toContain(COOKIE_NAME);
  });

  /* The uid is a credential's address in someone else's system; the browser has
     no use for it and every reason not to hold it. */
  it("never sends the store's uid or the hash to the client", async () => {
    stubStore();
    const { ctx } = createContext(null);
    const api = await caller(ctx);

    const user = await api.auth.register({ email: "supa@example.com", password: "Harbour-Falcon-2026" });
    expect(user).not.toHaveProperty("supabaseUid");
    expect(user).not.toHaveProperty("firebaseUid");
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("signs in through the store", async () => {
    stubStore();
    const { ctx, set } = createContext(null);
    const api = await caller(ctx);

    const user = await api.auth.login({ email: "supa@example.com", password: "Harbour-Falcon-2026" });
    expect(user.email).toBe("supa@example.com");
    expect(set.map(entry => entry.name)).toContain(COOKIE_NAME);
  });

  /* Whatever the service said, the shopper is told one thing, as a message key. */
  it("refuses a wrong password as UNAUTHORIZED with a message key", async () => {
    stubStore();
    const { ctx, set } = createContext(null);
    const api = await caller(ctx);

    await expect(api.auth.login({ email: "supa@example.com", password: "not-the-password" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED", message: "auth.invalidCredentials" });
    expect(set).toHaveLength(0);
  });

  it("answers a taken address with CONFLICT rather than a fault", async () => {
    class Taken extends Error {}
    stubStore({
      EmailTakenError: Taken,
      createLogin: async () => { throw new Taken(); },
    });
    const { ctx } = createContext(null);
    const api = await caller(ctx);

    await expect(api.auth.register({ email: "supa@example.com", password: "Harbour-Falcon-2026" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: "auth.emailTaken" });
  });

  /* Identical whether or not the address has an account, which is the whole
     reason this endpoint cannot be used to ask who is registered. */
  it("accepts a reset request the same way for any address", async () => {
    stubStore();
    const { ctx } = createContext(null);
    const api = await caller(ctx);

    await expect(api.auth.requestPasswordReset({ email: "supa@example.com", locale: "en" }))
      .resolves.toEqual({ sent: true });
    await expect(api.auth.requestPasswordReset({ email: "nobody@example.com", locale: "ar" }))
      .resolves.toEqual({ sent: true });
  });

  /* A fault on our side is logged, never surfaced: the shopper cannot act on it
     and the reply must not vary by address. */
  it("still answers the same way when the reset email cannot be sent", async () => {
    stubStore({ sendReset: async () => { throw new Error("SMTP is on fire"); } });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx } = createContext(null);
    const api = await caller(ctx);

    await expect(api.auth.requestPasswordReset({ email: "supa@example.com", locale: "en" }))
      .resolves.toEqual({ sent: true });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
