/**
 * Changing your own name, address and password, against a real Postgres.
 *
 * Firebase is unconfigured here, so these exercise the local scrypt path —
 * which is the fallback a deployment without Firebase actually runs on, and
 * the one where NetLet itself holds the digest.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { users } from "../../drizzle/schema.js";
import type { TrpcContext } from "../_core/context.js";
import type { User } from "../../drizzle/schema.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
const PASSWORD = "a-long-enough-password";

function contextFor(user: User | null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const reload = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  /*
   * `getDb` is module-local inside db.ts, so overriding the export does not
   * redirect db.ts's own callers. The two reads the sign-in path makes are
   * therefore given here, against this same database — both are plain lookups,
   * not logic worth duplicating.
   */
  vi.doMock("../db", async importOriginal => {
    const actual = await importOriginal<typeof import("../db")>();
    return {
      ...actual,
      getDb: async () => db,
      touchLastSignedIn: async () => {},
    };
  });
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  // `assertConfigured` refuses to sign anybody in without this. The value is
  // never dialled: `getDb` above is what the layer actually reaches for.
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost:5432/unused");
  ({ appRouter } = await import("../routers.js"));
}, 60_000);

async function freshUser(email: string) {
  const { hashPassword } = await import("../_core/password.js");
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(PASSWORD), name: "Original Name" })
    .returning();
  return row as User;
}

describe("changing your display name", () => {
  it("saves it, and clears it back to nothing", async () => {
    const user = await freshUser("name@example.com");
    const me = appRouter.createCaller(contextFor(user));

    expect((await me.auth.updateName({ name: "  New Name  " })).name).toBe("New Name");
    expect((await reload(user.id)).name).toBe("New Name");

    // Blank means "no display name", not the string "".
    await me.auth.updateName({ name: "" });
    expect((await reload(user.id)).name).toBeNull();
  });
});

describe("changing your email", () => {
  it("refuses without the current password", async () => {
    const user = await freshUser("move-me@example.com");
    const me = appRouter.createCaller(contextFor(user));
    await expect(
      me.auth.changeEmail({ email: "moved@example.com", currentPassword: "not-the-password" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // And nothing moved.
    expect((await reload(user.id)).email).toBe("move-me@example.com");
  });

  it("moves the login when the password is right, lowercasing on the way", async () => {
    const user = await freshUser("before@example.com");
    const me = appRouter.createCaller(contextFor(user));
    const updated = await me.auth.changeEmail({ email: "  After@Example.com ", currentPassword: PASSWORD });
    expect(updated.email).toBe("after@example.com");
    expect((await reload(user.id)).email).toBe("after@example.com");
  });

  it("refuses an address another account already has", async () => {
    const taken = await freshUser("taken@example.com");
    const user = await freshUser("wants-it@example.com");
    const me = appRouter.createCaller(contextFor(user));

    await expect(
      me.auth.changeEmail({ email: taken.email, currentPassword: PASSWORD }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await reload(user.id)).email).toBe("wants-it@example.com");
  });
});

describe("changing your password", () => {
  it("refuses without the current one", async () => {
    const user = await freshUser("pw-guard@example.com");
    const me = appRouter.createCaller(contextFor(user));
    await expect(
      me.auth.changePassword({ currentPassword: "wrong-password-here", newPassword: "a-brand-new-password" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("replaces it, and the new one is what signs in afterwards", async () => {
    const user = await freshUser("pw-change@example.com");
    const me = appRouter.createCaller(contextFor(user));
    await me.auth.changePassword({ currentPassword: PASSWORD, newPassword: "a-brand-new-password" });

    const guest = appRouter.createCaller(contextFor(null));
    // The old one is gone...
    await expect(
      guest.auth.login({ email: user.email, password: PASSWORD }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // ...and the new one works, which is the half a stored-hash check alone
    // would not prove.
    const signedIn = await guest.auth.login({ email: user.email, password: "a-brand-new-password" });
    expect(signedIn.id).toBe(user.id);
  });
});
