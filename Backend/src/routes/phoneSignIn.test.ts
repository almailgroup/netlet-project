/**
 * Signing in with a phone number, through the router, against a real Postgres.
 *
 * Supabase makes and checks the code, so it is stood in for: what is under
 * test is what NetLet does around it — which numbers it texts, which account
 * a proven number lands on, that a new one has no email until its owner adds
 * one (by a code, and only one nobody holds), and that an account made with a
 * phone confirms its own deletion by a texted code.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { users } from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";
import type { User } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
let serial = 0;

/** What the stand-in Supabase holds: the code it last texted each number. */
const texted = new Map<string, string>();
/** Codes it last emailed, by address, for adding an email. */
const emailed = new Map<string, string>();
let phoneOn = true;
const deletedUids: string[] = [];
const confirmedEmails: { uid: string; email: string }[] = [];

function contextFor(user: User | null, cookies: string[] = []): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {}, ip: `10.0.0.${serial % 250}` } as TrpcContext["req"],
    res: {
      cookie: (name: string) => { cookies.push(name); },
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

const uidFor = (phone: string) => `sb-${phone}`;
function freshPhone(): string {
  serial += 1;
  return `5${String(1000000 + serial).slice(-7)}`;
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
  vi.doMock("../core/sms", () => ({ smsReady: () => true, sendText: async () => {} }));
  vi.doMock("../core/supabaseAuth", async importOriginal => {
    const actual = await importOriginal<typeof import("../core/supabaseAuth")>();
    return {
      ...actual,
      isSupabaseAuthConfigured: () => true,
      supabaseExternalProviders: async () => ({ phone: phoneOn, email: true }),
      sendSupabasePhoneCode: async (phone: string) => {
        texted.set(phone, String(100000 + texted.size).slice(-6));
      },
      verifySupabasePhoneCode: async (phone: string, code: string) =>
        texted.get(phone) === code ? { uid: uidFor(phone), phone, email: null } : null,
      signUpSupabaseUser: async (input: { email: string }) => {
        emailed.set(input.email, "424242");
        return { kind: "codeSent" };
      },
      verifySupabaseSignupCode: async (email: string, code: string) =>
        emailed.get(email) === code ? { uid: `parked-${email}`, email, name: null, signedUp: true } : null,
      deleteSupabaseUser: async (uid: string) => { deletedUids.push(uid); },
      updateSupabaseUser: async (uid: string, patch: { email?: string; emailConfirmed?: boolean }) => {
        if (patch.email && patch.emailConfirmed) confirmedEmails.push({ uid, email: patch.email });
      },
      supabaseUserProviders: async () => ["phone"],
    };
  });
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost:5432/unused");
  vi.stubEnv("SMS_HOOK_SECRET", "v1,whsec_dGVzdC1zZWNyZXQtZm9yLXRoZS1zbXMtaG9vaw==");
  ({ appRouter } = await import("./index.js"));
}, 60_000);

afterEach(() => {
  phoneOn = true;
});

async function signUp(local: string) {
  const guest = appRouter.createCaller(contextFor(null));
  await guest.auth.phoneStart({ phone: local });
  const phone = `+965${local}`;
  return guest.auth.phoneVerify({ phone: local, code: texted.get(phone)! });
}

describe("Signing in with a phone number", () => {
  it("says it is offered only while Supabase has phone sign-in on", async () => {
    const guest = appRouter.createCaller(contextFor(null));
    expect((await guest.auth.providers()).phone).toBe(true);
    phoneOn = false;
    expect((await guest.auth.providers()).phone).toBe(false);
    await expect(guest.auth.phoneStart({ phone: freshPhone() })).rejects.toMatchObject({ message: "auth.phoneUnavailable" });
  });

  it("texts only a Kuwaiti mobile", async () => {
    const guest = appRouter.createCaller(contextFor(null));
    for (const phone of ["22345678", "+966501234567", "1234567"]) {
      await expect(guest.auth.phoneStart({ phone })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "auth.phoneInvalid" });
    }
  });

  it("opens an account with no email for a new number, and signs into it again", async () => {
    const local = freshPhone();
    const cookies: string[] = [];
    const first = await signUp(local);
    expect(first).toMatchObject({ phone: `+965${local}`, email: null, created: true, needsEmail: true });
    const [row] = await db.select().from(users).where(eq(users.phone, `+965${local}`));
    expect(row).toMatchObject({ email: null, supabaseUid: uidFor(`+965${local}`) });

    const again = appRouter.createCaller(contextFor(null, cookies));
    await again.auth.phoneStart({ phone: `+965 ${local}` });
    const second = await again.auth.phoneVerify({ phone: local, code: texted.get(`+965${local}`)! });
    expect(second).toMatchObject({ id: row.id, created: false });
    expect(cookies.length).toBe(1);
  });

  it("refuses a wrong code and counts it", async () => {
    const local = freshPhone();
    const guest = appRouter.createCaller(contextFor(null));
    await guest.auth.phoneStart({ phone: local });
    await expect(guest.auth.phoneVerify({ phone: local, code: "999999" })).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "auth.phoneCodeWrong" });
    await expect(guest.auth.phoneVerify({ phone: local, code: "12" })).rejects.toMatchObject({ message: "auth.codeShape" });
  });

  it("adds an email by a code, and only one nobody holds", async () => {
    const local = freshPhone();
    const signed = await signUp(local);
    const [row] = await db.select().from(users).where(eq(users.id, signed.id));
    const me = appRouter.createCaller(contextFor(row as User));

    await db.insert(users).values({ email: `held${serial}@example.com`, passwordHash: "x" });
    await expect(me.auth.addEmailStart({ email: `held${serial}@example.com` })).rejects.toMatchObject({ message: "auth.emailTaken" });

    const email = `phone${serial}@example.com`;
    await me.auth.addEmailStart({ email });
    await expect(me.auth.addEmailVerify({ email, code: "111111" })).rejects.toMatchObject({ message: "auth.codeWrong" });
    expect(await me.auth.addEmailVerify({ email, code: "424242" })).toMatchObject({ id: row.id, email, phone: `+965${local}` });
    expect(deletedUids).toContain(`parked-${email}`);
    expect(confirmedEmails).toContainEqual({ uid: row.supabaseUid, email });

    const [after] = await db.select().from(users).where(eq(users.id, row.id));
    const meAfter = appRouter.createCaller(contextFor(after as User));
    await expect(meAfter.auth.addEmailStart({ email: "another@example.com" })).rejects.toMatchObject({ message: "auth.emailAlreadyAdded" });
  });

  it("deletes an account made with a phone, confirmed by a code texted to it", async () => {
    const local = freshPhone();
    const signed = await signUp(local);
    const [row] = await db.select().from(users).where(eq(users.id, signed.id));
    const me = appRouter.createCaller(contextFor(row as User));
    expect(await me.auth.myProviders()).toMatchObject({ password: false, phone: true });

    await appRouter.createCaller(contextFor(null)).auth.phoneStart({ phone: local });
    await expect(me.auth.deleteAccount({ phoneCode: "000001" })).rejects.toMatchObject({ message: "auth.phoneCodeWrong" });
    expect(await me.auth.deleteAccount({ phoneCode: texted.get(`+965${local}`)! })).toEqual({ deleted: true });
    expect((await db.select().from(users).where(eq(users.id, row.id))).length).toBe(0);
  });

  it("keeps every account with an email or a phone", async () => {
    await expect(db.insert(users).values({ email: null, phone: null })).rejects.toThrow();
  });
});
