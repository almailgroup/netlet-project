/**
 * Sign in with Apple, through the router, against a real Postgres.
 *
 * Supabase is the one that checks Apple's token, so it is stood in for here:
 * what is under test is what NetLet does with the user Supabase answers —
 * which account that is, which address it may and may not take, what a new
 * account is given, and that deleting an Apple account confirms with Apple
 * and unlinks the Apple ID afterwards.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { customerProfiles, users } from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";
import type { User } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
let serial = 0;

type Answer = { uid: string; email: string; emailConfirmed?: boolean; signedUp?: boolean; providers?: string[] } | null;
let answer: Answer = null;
let appleOn = true;
let googleOn = true;
let microsoftOn = true;
/** The provider name the server last handed Supabase. */
let askedAs = "";
const passwordsSet: string[] = [];
const deletedUids: string[] = [];
let providersOf: Record<string, string[]> = {};
const fetched: string[] = [];

function contextFor(user: User | null, cookies: string[] = [], cleared: string[] = []): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      cookie: (name: string) => { cookies.push(name); },
      clearCookie: (name: string) => { cleared.push(name); },
    } as unknown as TrpcContext["res"],
  };
}

const proof = { idToken: tokenFor("com.netlet.marketplace"), nonce: "a-nonce-long-enough-0123", code: "c0de" };

/** An identity token's shape, with only the claim the server reads. */
function tokenFor(aud: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ aud, sub: "001234.apple" })}.signature`;
}

const rowOf = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0];

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
      supabaseExternalProviders: async () => ({ apple: appleOn, google: googleOn, azure: microsoftOn, email: true }),
      signInSupabaseWithIdToken: async (provider: string) =>
        (askedAs = provider) && answer && {
          uid: answer.uid,
          email: answer.email,
          name: null,
          signedUp: answer.signedUp ?? false,
          emailConfirmed: answer.emailConfirmed ?? true,
          providers: answer.providers ?? ["apple"],
        },
      supabaseUserProviders: async (uid: string) => providersOf[uid] ?? null,
      updateSupabaseUser: async (uid: string, patch: { password?: string }) => {
        if (patch.password) passwordsSet.push(uid);
      },
      deleteSupabaseUser: async (uid: string) => {
        deletedUids.push(uid);
      },
    };
  });
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost:5432/unused");
  vi.stubEnv("APPLE_SIGNIN_SERVICES_ID", "net.netlet.web");
  vi.stubEnv("GOOGLE_SIGNIN_WEB_CLIENT_ID", "web-1.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_SIGNIN_IOS_CLIENT_ID", "ios-1.apps.googleusercontent.com");
  vi.stubEnv("MICROSOFT_SIGNIN_CLIENT_ID", "11111111-2222-3333-4444-555555555555");
  vi.stubEnv("APPLE_SIGNIN_TEAM_ID", "TEAM123456");
  vi.stubEnv("APPLE_SIGNIN_KEY_ID", "KEY1234567");
  // A real P-256 key, made for this test, so the client secret is really signed.
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  vi.stubEnv("APPLE_SIGNIN_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  ({ appRouter } = await import("./index.js"));
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
  answer = null;
  appleOn = true;
  googleOn = true;
  microsoftOn = true;
});

function freshEmail(): string {
  serial += 1;
  return `apple${serial}@example.com`;
}

describe("Sign in with Apple", () => {
  it("says which ways in are on: the app's always with Apple on, the website's with its Services ID", async () => {
    const guest = appRouter.createCaller(contextFor(null));
    expect(await guest.auth.providers()).toEqual({
      apple: { app: true, web: "net.netlet.web" },
      google: { web: "web-1.apps.googleusercontent.com", ios: "ios-1.apps.googleusercontent.com" },
      microsoft: { web: "11111111-2222-3333-4444-555555555555", ios: "11111111-2222-3333-4444-555555555555" },
    });
    appleOn = false;
    googleOn = false;
    microsoftOn = false;
    expect(await guest.auth.providers()).toEqual({
      apple: { app: false, web: null },
      google: { web: null, ios: null },
      microsoft: { web: null, ios: null },
    });
  });

  it("opens an account for an Apple ID it has not met, with the name Apple gave, and signs in", async () => {
    const email = freshEmail();
    answer = { uid: `uid-${serial}`, email };
    const cookies: string[] = [];
    const guest = appRouter.createCaller(contextFor(null, cookies));
    const result = await guest.auth.appleSignIn({ ...proof, firstName: "Noura", lastName: "Al-Sabah" });
    expect(result).toMatchObject({ email, name: "Noura Al-Sabah", created: true, portal: null });
    expect(cookies).toHaveLength(1);
    const row = await rowOf(email);
    expect(row).toMatchObject({ supabaseUid: `uid-${serial}`, passwordHash: null });
    const [parts] = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, row.id));
    expect(parts).toMatchObject({ firstName: "Noura", lastName: "Al-Sabah" });

    // The same Apple ID again is the same account, and makes nothing new.
    const again = await guest.auth.appleSignIn(proof);
    expect(again).toMatchObject({ id: row.id, created: false });
  });

  it("lands on the account Supabase linked by address, whichever address Apple names", async () => {
    const email = freshEmail();
    const [existing] = await db.insert(users).values({ email, supabaseUid: `linked-${serial}`, name: "Had a password" }).returning();
    // Hide My Email: Apple names a relay address, Supabase still answers the user it linked.
    answer = { uid: `linked-${serial}`, email: `relay${serial}@privaterelay.appleid.com`, providers: ["email", "apple"] };
    const result = await appRouter.createCaller(contextFor(null)).auth.appleSignIn(proof);
    expect(result).toMatchObject({ id: existing.id, created: false, name: "Had a password" });
  });

  it("refuses an address another account holds by a password NetLet keeps, rather than taking it over", async () => {
    const email = freshEmail();
    const { hashPassword } = await import("../core/password.js");
    await db.insert(users).values({ email, passwordHash: await hashPassword("a-long-enough-password") });
    answer = { uid: `stranger-${serial}`, email };
    await expect(appRouter.createCaller(contextFor(null)).auth.appleSignIn(proof))
      .rejects.toMatchObject({ code: "CONFLICT", message: "auth.appleEmailTaken" });
    expect((await rowOf(email)).supabaseUid).toBeNull();
  });

  it("refuses an address another Supabase user holds", async () => {
    const email = freshEmail();
    await db.insert(users).values({ email, supabaseUid: `someone-else-${serial}` });
    answer = { uid: `stranger-${serial}`, email };
    await expect(appRouter.createCaller(contextFor(null)).auth.appleSignIn(proof))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect((await rowOf(email)).supabaseUid).toBe(`someone-else-${serial}`);
  });

  it("adopts a row with no credential at all, but only for an address Supabase holds as confirmed", async () => {
    const email = freshEmail();
    const [bare] = await db.insert(users).values({ email }).returning();
    answer = { uid: `bare-${serial}`, email, emailConfirmed: false };
    await expect(appRouter.createCaller(contextFor(null)).auth.appleSignIn(proof)).rejects.toMatchObject({ code: "CONFLICT" });
    answer = { uid: `bare-${serial}`, email, emailConfirmed: true };
    expect(await appRouter.createCaller(contextFor(null)).auth.appleSignIn(proof)).toMatchObject({ id: bare.id, created: false });
    expect((await rowOf(email)).supabaseUid).toBe(`bare-${serial}`);
  });

  it("replaces a password left by a sign-up nobody confirmed, which whoever began it might know", async () => {
    const email = freshEmail();
    answer = { uid: `waiting-${serial}`, email, signedUp: true, providers: ["email", "apple"] };
    await appRouter.createCaller(contextFor(null)).auth.appleSignIn(proof);
    expect(passwordsSet).toContain(`waiting-${serial}`);
  });

  it("refuses a token Supabase refused, and counts it", async () => {
    answer = null;
    await expect(appRouter.createCaller(contextFor(null)).auth.appleSignIn(proof))
      .rejects.toMatchObject({ code: "UNAUTHORIZED", message: "auth.appleRefused" });
  });

  it("refuses while Apple is off in Supabase", async () => {
    appleOn = false;
    answer = { uid: "whatever", email: freshEmail() };
    await expect(appRouter.createCaller(contextFor(null)).auth.appleSignIn(proof))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "auth.appleUnavailable" });
  });

  it("says how an account signs in, and asks for the password when Supabase cannot say", async () => {
    const email = freshEmail();
    const [row] = await db.insert(users).values({ email, supabaseUid: `ways-${serial}` }).returning();
    const me = appRouter.createCaller(contextFor(row as User));
    expect(await me.auth.myProviders()).toEqual({ password: true, apple: false, google: false, microsoft: false });
    providersOf[`ways-${serial}`] = ["apple"];
    expect(await me.auth.myProviders()).toEqual({ password: false, apple: true, google: false, microsoft: false });
    providersOf[`ways-${serial}`] = ["email", "google"];
    expect(await me.auth.myProviders()).toEqual({ password: true, apple: false, google: true, microsoft: false });
    // Supabase calls Microsoft "azure".
    providersOf[`ways-${serial}`] = ["azure"];
    expect(await me.auth.myProviders()).toEqual({ password: false, apple: false, google: false, microsoft: true });
    providersOf = {};
  });

  it("deletes an Apple account confirmed with Apple, and unlinks the Apple ID with the app's client id", async () => {
    const email = freshEmail();
    answer = { uid: `leaving-${serial}`, email };
    await appRouter.createCaller(contextFor(null)).auth.appleSignIn(proof);
    const row = (await rowOf(email)) as User;

    // Confirming with somebody else's Apple ID does nothing.
    answer = { uid: "another-apple-id", email: "other@example.com" };
    const me = appRouter.createCaller(contextFor(row));
    await expect(me.auth.deleteAccount({ apple: proof })).rejects.toMatchObject({ message: "auth.appleNotThisAccount" });
    // Neither does nothing at all.
    await expect(me.auth.deleteAccount({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await rowOf(email)).toBeDefined();

    const calls: { url: string; body: URLSearchParams }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls.push({ url, body: new URLSearchParams(init.body) });
      fetched.push(url);
      return url.endsWith("/auth/token")
        ? new Response(JSON.stringify({ refresh_token: "r-token", access_token: "a-token" }), { status: 200 })
        : new Response("", { status: 200 });
    });
    answer = { uid: row.supabaseUid!, email };
    expect(await me.auth.deleteAccount({ apple: proof })).toEqual({ deleted: true });
    expect(await rowOf(email)).toBeUndefined();
    expect(deletedUids).toContain(row.supabaseUid);

    expect(calls.map(call => call.url)).toEqual(["https://appleid.apple.com/auth/token", "https://appleid.apple.com/auth/revoke"]);
    expect(calls[0].body.get("client_id")).toBe("com.netlet.marketplace");
    expect(calls[0].body.get("code")).toBe("c0de");
    expect(calls[1].body.get("token")).toBe("r-token");
    expect(calls[1].body.get("token_type_hint")).toBe("refresh_token");
    // The client secret is an ES256 JWT for that client id, signed by the team.
    const [header, claims] = calls[0].body.get("client_secret")!.split(".").slice(0, 2)
      .map(part => JSON.parse(Buffer.from(part, "base64url").toString("utf8")));
    expect(header).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    expect(claims).toMatchObject({ iss: "TEAM123456", sub: "com.netlet.marketplace", aud: "https://appleid.apple.com" });
  });

  it("still deletes the account when Apple does not answer", async () => {
    const email = freshEmail();
    answer = { uid: `quiet-${serial}`, email };
    await appRouter.createCaller(contextFor(null)).auth.appleSignIn(proof);
    const row = (await rowOf(email)) as User;
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await appRouter.createCaller(contextFor(row)).auth.deleteAccount({ apple: proof })).toEqual({ deleted: true });
    expect(await rowOf(email)).toBeUndefined();
  });
});

/** A Google identity token's shape, with the claims the server reads. */
function googleToken(claims: object): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ aud: "web-1.apps.googleusercontent.com", sub: "1077", ...claims })}.signature`;
}

describe("Sign in with Google", () => {
  it("opens an account with the name Google's token carries, and lands on it again", async () => {
    const email = freshEmail();
    answer = { uid: `g-${serial}`, email, providers: ["google"] };
    const proofG = { idToken: googleToken({ given_name: "Shelby", family_name: "Og" }), nonce: "a-nonce-long-enough-0123" };
    const guest = appRouter.createCaller(contextFor(null));
    expect(await guest.auth.googleSignIn(proofG)).toMatchObject({ email, name: "Shelby Og", created: true });
    const row = await rowOf(email);
    const [parts] = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, row.id));
    expect(parts).toMatchObject({ firstName: "Shelby", lastName: "Og" });
    expect(await guest.auth.googleSignIn(proofG)).toMatchObject({ id: row.id, created: false });
  });

  it("refuses an address a password NetLet keeps holds, and a Google that is switched off", async () => {
    const email = freshEmail();
    const { hashPassword } = await import("../core/password.js");
    await db.insert(users).values({ email, passwordHash: await hashPassword("a-long-enough-password") });
    answer = { uid: `g-stranger-${serial}`, email, providers: ["google"] };
    const proofG = { idToken: googleToken({}), nonce: "a-nonce-long-enough-0123" };
    await expect(appRouter.createCaller(contextFor(null)).auth.googleSignIn(proofG))
      .rejects.toMatchObject({ code: "CONFLICT", message: "auth.googleEmailTaken" });
    googleOn = false;
    await expect(appRouter.createCaller(contextFor(null)).auth.googleSignIn(proofG))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "auth.googleUnavailable" });
  });

  it("deletes a Google account confirmed with the same Google account, and only that one", async () => {
    const email = freshEmail();
    answer = { uid: `g-leaving-${serial}`, email, providers: ["google"] };
    const proofG = { idToken: googleToken({}), nonce: "a-nonce-long-enough-0123" };
    await appRouter.createCaller(contextFor(null)).auth.googleSignIn(proofG);
    const row = (await rowOf(email)) as User;
    const me = appRouter.createCaller(contextFor(row));
    answer = { uid: "another-google-account", email: "other@example.com" };
    await expect(me.auth.deleteAccount({ google: proofG })).rejects.toMatchObject({ message: "auth.googleNotThisAccount" });
    answer = { uid: row.supabaseUid!, email };
    expect(await me.auth.deleteAccount({ google: proofG })).toEqual({ deleted: true });
    expect(await rowOf(email)).toBeUndefined();
  });
});

describe("Sign in with Microsoft", () => {
  it("asks Supabase as \"azure\", and names the account from the token's one name", async () => {
    const email = freshEmail();
    answer = { uid: `m-${serial}`, email, providers: ["azure"] };
    const proofM = { idToken: googleToken({ name: "Noura Al-Sabah" }), nonce: "a-nonce-long-enough-0123" };
    const guest = appRouter.createCaller(contextFor(null));
    expect(await guest.auth.microsoftSignIn(proofM)).toMatchObject({ email, name: "Noura Al-Sabah", created: true });
    expect(askedAs).toBe("azure");
    const row = await rowOf(email);
    const [parts] = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, row.id));
    expect(parts).toMatchObject({ firstName: "Noura", lastName: "Al-Sabah" });
    expect(await guest.auth.microsoftSignIn(proofM)).toMatchObject({ id: row.id, created: false });
  });

  it("refuses an address a password NetLet keeps holds, and a Microsoft that is switched off", async () => {
    const email = freshEmail();
    const { hashPassword } = await import("../core/password.js");
    await db.insert(users).values({ email, passwordHash: await hashPassword("a-long-enough-password") });
    answer = { uid: `m-stranger-${serial}`, email, providers: ["azure"] };
    const proofM = { idToken: googleToken({}), nonce: "a-nonce-long-enough-0123" };
    await expect(appRouter.createCaller(contextFor(null)).auth.microsoftSignIn(proofM))
      .rejects.toMatchObject({ code: "CONFLICT", message: "auth.microsoftEmailTaken" });
    microsoftOn = false;
    await expect(appRouter.createCaller(contextFor(null)).auth.microsoftSignIn(proofM))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "auth.microsoftUnavailable" });
  });

  it("deletes a Microsoft account confirmed with the same Microsoft account, and only that one", async () => {
    const email = freshEmail();
    answer = { uid: `m-leaving-${serial}`, email, providers: ["azure"] };
    const proofM = { idToken: googleToken({}), nonce: "a-nonce-long-enough-0123" };
    await appRouter.createCaller(contextFor(null)).auth.microsoftSignIn(proofM);
    const row = (await rowOf(email)) as User;
    const me = appRouter.createCaller(contextFor(row));
    answer = { uid: "another-microsoft-account", email: "other@example.com" };
    await expect(me.auth.deleteAccount({ microsoft: proofM })).rejects.toMatchObject({ message: "auth.microsoftNotThisAccount" });
    answer = { uid: row.supabaseUid!, email };
    expect(await me.auth.deleteAccount({ microsoft: proofM })).toEqual({ deleted: true });
    expect(await rowOf(email)).toBeUndefined();
  });
});
