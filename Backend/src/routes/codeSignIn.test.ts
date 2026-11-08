/**
 * Signing in with a one-time code emailed to the account, through the router,
 * against a real Postgres.
 *
 * Supabase makes, mails and checks the code, so it is stood in for: what is
 * under test is what NetLet does around it — the same answer for an address
 * with no account, which account a proven inbox lands on, that a sign-up whose
 * code never came back is opened with its password made one nobody knows, and
 * that an address a NetLet account holds by its own password is not adopted.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { users } from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
let serial = 0;

/** The users the stand-in Supabase holds, by address. */
const held = new Map<string, { uid: string; signedUp: boolean; name: string | null }>();
/** The code it last emailed each address. */
const mailed = new Map<string, string>();
const scrambled: string[] = [];

function contextFor(cookies: string[] = []): TrpcContext {
  serial += 1;
  return {
    user: null,
    req: { protocol: "https", headers: {}, ip: `10.1.0.${serial % 250}` } as TrpcContext["req"],
    res: {
      cookie: (name: string) => { cookies.push(name); },
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function freshEmail(label: string): string {
  serial += 1;
  return `${label}${serial}@example.com`;
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
  vi.doMock("../core/supabaseAuth", async importOriginal => {
    const actual = await importOriginal<typeof import("../core/supabaseAuth")>();
    return {
      ...actual,
      isSupabaseAuthConfigured: () => true,
      sendSupabaseSignInCode: async (email: string) => {
        if (!held.has(email)) return false;
        mailed.set(email, String(200000 + mailed.size).slice(-6));
        return true;
      },
      verifySupabaseSignupCode: async (email: string, code: string) => {
        const user = held.get(email);
        return user && mailed.get(email) === code ? { uid: user.uid, email, name: user.name, signedUp: user.signedUp } : null;
      },
      updateSupabaseUser: async (uid: string, patch: { password?: string }) => {
        if (patch.password) scrambled.push(uid);
      },
    };
  });
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost:5432/unused");
  ({ appRouter } = await import("./index.js"));
}, 60_000);

describe("Signing in with a one-time code", () => {
  it("signs into the account the inbox belongs to", async () => {
    const email = freshEmail("shopper");
    held.set(email, { uid: `sb-${email}`, signedUp: true, name: "Noura" });
    const [row] = await db.insert(users).values({ email, supabaseUid: `sb-${email}`, name: "Noura" }).returning();

    const cookies: string[] = [];
    const guest = appRouter.createCaller(contextFor(cookies));
    expect(await guest.auth.codeStart({ email: email.toUpperCase() })).toEqual({ sent: true, email });
    const signed = await guest.auth.codeSignIn({ email, code: mailed.get(email)!, remember: false });
    expect(signed).toMatchObject({ id: row.id, email, name: "Noura", portal: null });
    expect(cookies.length).toBe(1);
    expect(scrambled).not.toContain(`sb-${email}`);
  });

  it("answers an address with no account exactly as it answers one with an account", async () => {
    const email = freshEmail("nobody");
    const guest = appRouter.createCaller(contextFor());
    expect(await guest.auth.codeStart({ email })).toEqual({ sent: true, email });
    expect(mailed.has(email)).toBe(false);
    await expect(guest.auth.codeSignIn({ email, code: "123456" })).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "auth.codeWrong" });
  });

  it("refuses a wrong code, and a code that is not six digits", async () => {
    const email = freshEmail("typo");
    held.set(email, { uid: `sb-${email}`, signedUp: false, name: null });
    await db.insert(users).values({ email, supabaseUid: `sb-${email}` });
    const guest = appRouter.createCaller(contextFor());
    await guest.auth.codeStart({ email });
    await expect(guest.auth.codeSignIn({ email, code: "999999" })).rejects.toMatchObject({ message: "auth.codeWrong" });
    await expect(guest.auth.codeSignIn({ email, code: "12" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "auth.codeShape" });
  });

  it("opens an account Supabase holds that NetLet has no row for yet", async () => {
    const email = freshEmail("dashboard");
    held.set(email, { uid: `sb-${email}`, signedUp: false, name: "Added by hand" });
    const guest = appRouter.createCaller(contextFor());
    await guest.auth.codeStart({ email });
    const signed = await guest.auth.codeSignIn({ email, code: mailed.get(email)! });
    const [row] = await db.select().from(users).where(eq(users.email, email));
    expect(signed).toMatchObject({ id: row.id, name: "Added by hand" });
    expect(row.supabaseUid).toBe(`sb-${email}`);
    expect(scrambled).not.toContain(`sb-${email}`);
  });

  it("makes the password of a sign-up nobody confirmed one nobody knows", async () => {
    const email = freshEmail("halfway");
    held.set(email, { uid: `sb-${email}`, signedUp: true, name: null });
    const guest = appRouter.createCaller(contextFor());
    await guest.auth.codeStart({ email });
    await guest.auth.codeSignIn({ email, code: mailed.get(email)! });
    expect(scrambled).toContain(`sb-${email}`);
  });

  it("never adopts an account that signs in with a password NetLet keeps", async () => {
    const email = freshEmail("local");
    await db.insert(users).values({ email, passwordHash: "scrypt$not-a-real-digest" });
    held.set(email, { uid: `sb-other-${email}`, signedUp: false, name: null });
    const guest = appRouter.createCaller(contextFor());
    await guest.auth.codeStart({ email });
    await expect(guest.auth.codeSignIn({ email, code: mailed.get(email)! })).rejects.toMatchObject({ code: "CONFLICT", message: "auth.codeUsePassword" });
    const [row] = await db.select().from(users).where(eq(users.email, email));
    expect(row.supabaseUid).toBeNull();
  });
});
