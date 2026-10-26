/**
 * Sign-in throttling, against a real Postgres.
 *
 * The policy is proved pure in `Shared/auth/rateLimit.test.ts`. What these
 * cover is the half that cannot be: that the counts are kept somewhere every
 * instance can see, that only failures are counted, and that succeeding
 * forgives an account without forgiving the host it was tried from.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authAttempts, users } from "../../database/schema.js";
import type { TrpcContext, } from "../core/context.js";
import type { User } from "../../database/schema.js";
import { MAX_FAILURES_PER_ACCOUNT } from "../../../Shared/auth/rateLimit.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
const PASSWORD = "a-long-enough-password";

/** A caller from a given address — the second key the limiter uses. */
function contextFrom(address: string): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {}, ip: address } as unknown as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
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
    return {
      ...actual,
      getDb: async () => db,
      touchLastSignedIn: async () => {},
    };
  });
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost:5432/unused");
  ({ appRouter } = await import("./index.js"));
}, 60_000);

beforeEach(async () => {
  await db.delete(authAttempts);
});

async function freshUser(email: string): Promise<User> {
  const { hashPassword } = await import("../core/password.js");
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(PASSWORD), name: "Shopper" })
    .returning();
  return row as User;
}

const wrongPassword = (email: string) => ({ email, password: "definitely-not-the-password" });

describe("sign-in throttling", () => {
  it("refuses an account once it has failed too often, from any address", async () => {
    await freshUser("guessed@example.com");

    // Each failure from a different address: per-address counting would never
    // catch this, which is the reason the account key exists.
    for (let attempt = 0; attempt < MAX_FAILURES_PER_ACCOUNT; attempt += 1) {
      const caller = appRouter.createCaller(contextFrom(`10.0.0.${attempt}`));
      await expect(caller.auth.login(wrongPassword("guessed@example.com"))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    }

    const next = appRouter.createCaller(contextFrom("10.0.0.200"));
    await expect(next.auth.login(wrongPassword("guessed@example.com"))).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  /*
   * The throttle must not answer the question the sign-in reply refuses to:
   * a locked-out caller is told to wait, never that the password was wrong or
   * right, and never whether the address is registered at all.
   */
  it("says 'too many', not 'wrong password', once it is refusing", async () => {
    await freshUser("locked@example.com");
    const caller = appRouter.createCaller(contextFrom("10.0.1.1"));
    for (let attempt = 0; attempt < MAX_FAILURES_PER_ACCOUNT; attempt += 1) {
      await caller.auth.login(wrongPassword("locked@example.com")).catch(() => {});
    }

    // And the correct password is refused too — otherwise the throttle is an
    // oracle that says "that one was right" by behaving differently.
    await expect(
      caller.auth.login({ email: "locked@example.com", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: "auth.tooManyAttempts" });
  });

  it("counts nothing when the password is right", async () => {
    await freshUser("fine@example.com");
    const caller = appRouter.createCaller(contextFrom("10.0.2.1"));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await caller.auth.login({ email: "fine@example.com", password: PASSWORD });
    }
    expect(await db.select().from(authAttempts)).toHaveLength(0);
  });

  /*
   * Somebody who mistyped nine times and then remembered is not one slip from
   * a quarter of an hour locked out.
   */
  it("forgives an account's failures once it signs in", async () => {
    await freshUser("forgiven@example.com");
    const caller = appRouter.createCaller(contextFrom("10.0.3.1"));
    for (let attempt = 0; attempt < MAX_FAILURES_PER_ACCOUNT - 1; attempt += 1) {
      await caller.auth.login(wrongPassword("forgiven@example.com")).catch(() => {});
    }
    await caller.auth.login({ email: "forgiven@example.com", password: PASSWORD });

    const left = await db.select().from(authAttempts).where(eq(authAttempts.bucket, "account:forgiven@example.com"));
    expect(left).toHaveLength(0);
  });

  /*
   * But signing in successfully once must not wipe what the *host* has been
   * doing to everybody else's accounts — otherwise an attacker with one
   * account of their own clears their own record at will.
   */
  it("does not let one success launder an address's record", async () => {
    await freshUser("mine@example.com");
    await freshUser("theirs@example.com");
    const caller = appRouter.createCaller(contextFrom("10.0.4.1"));

    await caller.auth.login(wrongPassword("theirs@example.com")).catch(() => {});
    await caller.auth.login({ email: "mine@example.com", password: PASSWORD });

    const address = await db.select().from(authAttempts).where(eq(authAttempts.bucket, "address:10.0.4.1"));
    expect(address).toHaveLength(1);
  });

  it("keys an account case-insensitively, as sign-in does", async () => {
    await freshUser("mixed@example.com");
    const caller = appRouter.createCaller(contextFrom("10.0.5.1"));
    await caller.auth.login(wrongPassword("MIXED@Example.com")).catch(() => {});

    const rows = await db.select().from(authAttempts).where(eq(authAttempts.bucket, "account:mixed@example.com"));
    expect(rows).toHaveLength(1);
  });
});

describe("password-reset throttling", () => {
  /*
   * There is no failure to count: the reply is identical for an address with
   * no account, deliberately. So every request counts, and the abuse being
   * stopped is using NetLet to post mail into somebody's inbox repeatedly.
   */
  it("counts every request, not only the ones that found an account", async () => {
    const caller = appRouter.createCaller(contextFrom("10.0.6.1"));
    await caller.auth.requestPasswordReset({ email: "nobody@example.com", locale: "en" });
    await caller.auth.requestPasswordReset({ email: "nobody@example.com", locale: "en" });

    const rows = await db.select().from(authAttempts).where(eq(authAttempts.bucket, "account:nobody@example.com"));
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.kind === "reset")).toBe(true);
  });

  it("counts sign-in and reset separately, so one cannot lock the other out", async () => {
    await freshUser("both@example.com");
    const caller = appRouter.createCaller(contextFrom("10.0.7.1"));
    for (let attempt = 0; attempt < MAX_FAILURES_PER_ACCOUNT; attempt += 1) {
      await caller.auth.login(wrongPassword("both@example.com")).catch(() => {});
    }
    // Sign-in is now refusing; asking for a reset is how you recover from that,
    // so it must still work.
    await expect(
      caller.auth.requestPasswordReset({ email: "both@example.com", locale: "en" }),
    ).resolves.toMatchObject({ sent: true });
  });
});

/*
 * One table holds every ceiling, and two sign-in housekeeping steps reached
 * past their own kind: pruning at fifteen minutes on every failed sign-in
 * deleted hourly and daily counts, and forgiving an account on sign-in
 * deleted its other per-account counts — so signing in again reset
 * them.
 */
describe("the other ceilings in the same table", () => {
  it("survive a failed sign-in's pruning and a successful sign-in's forgiving", async () => {
    await freshUser("keeps@example.com");
    const halfAnHourAgo = new Date(Date.now() - 30 * 60 * 1000);
    await db.insert(authAttempts).values([
      { bucket: "account:keeps@example.com", kind: "photoSearch", createdAt: halfAnHourAgo },
      { bucket: "account:keeps@example.com", kind: "offerRequest", createdAt: halfAnHourAgo },
      { bucket: "address:10.0.9.1", kind: "assistant", createdAt: halfAnHourAgo },
      { bucket: "account:keeps@example.com", kind: "login", createdAt: halfAnHourAgo },
    ]);
    const caller = appRouter.createCaller(contextFrom("10.0.9.1"));
    await caller.auth.login(wrongPassword("keeps@example.com")).catch(() => {});
    await caller.auth.login({ email: "keeps@example.com", password: PASSWORD });

    const kinds = (await db.select({ kind: authAttempts.kind, bucket: authAttempts.bucket }).from(authAttempts)).map(row => `${row.bucket} ${row.kind}`).sort();
    expect(kinds).toEqual([
      "account:keeps@example.com offerRequest",
      "account:keeps@example.com photoSearch",
      /* The failed attempt against the address stays: success forgives the account, not the host. */
      "address:10.0.9.1 assistant",
      "address:10.0.9.1 login",
    ]);
  });
});

/*
 * A discount code is a word somebody chose, and checkout's quote answered any
 * number of guesses from a signed-out browser. Only codes naming nothing
 * count, and past the ceiling the right one is refused too — or the ceiling
 * would itself say which guess was right.
 */
describe("guessing at codes", () => {
  it("refuses an address after enough codes that named nothing, the real one included", async () => {
    const { discountCodes, carts } = await import("../../database/schema.js");
    const { MAX_VOUCHER_MISSES_PER_ADDRESS } = await import("../../../Shared/auth/rateLimit.js");
    await db.delete(discountCodes);
    await db.insert(discountCodes).values({ code: "REALONE", kind: "fixed", value: "1.000" });
    const [cart] = await db.insert(carts).values({ id: `cart-guess-${Date.now()}` }).returning();
    const caller = appRouter.createCaller(contextFrom("203.0.113.40"));

    /* A real code answers and counts nothing, however often it is asked. */
    for (let i = 0; i < MAX_VOUCHER_MISSES_PER_ADDRESS + 2; i += 1) {
      expect((await caller.orders.quoteVoucher({ cartId: cart.id, code: "REALONE" })).ok).toBe(true);
    }
    for (let i = 0; i < MAX_VOUCHER_MISSES_PER_ADDRESS; i += 1) {
      expect(await caller.orders.quoteVoucher({ cartId: cart.id, code: `GUESS${i}` })).toMatchObject({ ok: false, reason: "voucher.unknown" });
    }
    await expect(caller.orders.quoteVoucher({ cartId: cart.id, code: "REALONE" }))
      .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: "voucher.tooMany" });

    /* Somebody else, at another address, is not held to it. */
    const other = appRouter.createCaller(contextFrom("203.0.113.41"));
    expect((await other.orders.quoteVoucher({ cartId: cart.id, code: "REALONE" })).ok).toBe(true);
  });
});
