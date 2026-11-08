/**
 * Signing in with Face ID, through the router, against a real Postgres.
 *
 * The phone is stood in for by a P-256 key made here: what is under test is
 * what NetLet does with the public half — that only the account signed in can
 * set one up, that a challenge is good once and only for its key, that a
 * signature from any other key is refused and counted, that a key turned off
 * says so (so the phone forgets it), and that before migration 0078 is pasted
 * the whole thing is closed rather than broken.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, sql } from "drizzle-orm";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { authAttempts, biometricKeys, users, type User } from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";
import { MAX_BIOMETRIC_KEYS, biometricMessage } from "../../../Shared/auth/biometricKey.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
let serial = 0;

function contextFor(user: User | null, cookies: string[] = [], address = "10.2.0.1"): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {}, ip: address } as TrpcContext["req"],
    res: { cookie: (name: string) => { cookies.push(name); }, clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

/** A phone: a key pair, the public half as `SecKeyCopyExternalRepresentation` gives it, and an id. */
function phone() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  return { privateKey, publicKey: point.toString("base64"), keyId: randomBytes(24).toString("base64url") };
}

function signed(privateKey: KeyObject, challenge: string): string {
  return sign("sha256", Buffer.from(biometricMessage(challenge), "utf-8"), { key: privateKey, dsaEncoding: "der" }).toString("base64");
}

async function account(label: string): Promise<User> {
  serial += 1;
  const [row] = await db.insert(users).values({ email: `${label}${serial}@example.com`, name: label, supabaseUid: `sb-${label}-${serial}` }).returning();
  return row;
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

describe("Signing in with Face ID", () => {
  it("signs into the account that set the phone up", async () => {
    const user = await account("noura");
    const device = phone();
    const me = appRouter.createCaller(contextFor(user));
    expect(await me.auth.biometricRegister({ keyId: device.keyId, publicKey: device.publicKey, deviceName: "  Noura's   iPhone " })).toEqual({ ok: true });
    const listed = await me.auth.biometricKeys();
    expect(listed.ready).toBe(true);
    expect(listed.keys).toMatchObject([{ keyId: device.keyId, deviceName: "Noura's iPhone", lastUsedAt: null }]);

    const cookies: string[] = [];
    const guest = appRouter.createCaller(contextFor(null, cookies));
    const { challenge, active } = await guest.auth.biometricChallenge({ keyId: device.keyId });
    expect(active).toBe(true);
    const answer = await guest.auth.biometricSignIn({ keyId: device.keyId, challenge, signature: signed(device.privateKey, challenge) });
    expect(answer).toMatchObject({ id: user.id, email: user.email, portal: null });
    expect(cookies.length).toBe(1);

    const [row] = await db.select().from(biometricKeys).where(eq(biometricKeys.keyId, device.keyId));
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("spends a challenge once", async () => {
    const user = await account("replay");
    const device = phone();
    await appRouter.createCaller(contextFor(user)).auth.biometricRegister({ keyId: device.keyId, publicKey: device.publicKey });
    const guest = appRouter.createCaller(contextFor(null, [], "10.2.0.2"));
    const { challenge } = await guest.auth.biometricChallenge({ keyId: device.keyId });
    const signature = signed(device.privateKey, challenge);
    await guest.auth.biometricSignIn({ keyId: device.keyId, challenge, signature });
    await expect(guest.auth.biometricSignIn({ keyId: device.keyId, challenge, signature })).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "auth.faceIdFailed" });
  });

  it("refuses another key's signature, a challenge for another key and a forged challenge, and counts each", async () => {
    const user = await account("forged");
    const device = phone();
    const thief = phone();
    await appRouter.createCaller(contextFor(user)).auth.biometricRegister({ keyId: device.keyId, publicKey: device.publicKey });
    const address = "10.2.0.3";
    const guest = appRouter.createCaller(contextFor(null, [], address));

    const { challenge } = await guest.auth.biometricChallenge({ keyId: device.keyId });
    await expect(guest.auth.biometricSignIn({ keyId: device.keyId, challenge, signature: signed(thief.privateKey, challenge) }))
      .rejects.toMatchObject({ message: "auth.faceIdFailed" });

    const theirs = await guest.auth.biometricChallenge({ keyId: thief.keyId });
    expect(theirs.active).toBe(false);
    await expect(guest.auth.biometricSignIn({ keyId: device.keyId, challenge: theirs.challenge, signature: signed(device.privateKey, theirs.challenge) }))
      .rejects.toMatchObject({ message: "auth.faceIdFailed" });

    const forged = "x".repeat(40);
    await expect(guest.auth.biometricSignIn({ keyId: device.keyId, challenge: forged, signature: signed(device.privateKey, forged) }))
      .rejects.toMatchObject({ message: "auth.faceIdFailed" });

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(authAttempts).where(eq(authAttempts.kind, "faceMiss"));
    expect(n).toBeGreaterThanOrEqual(3);

    // The right signature still signs in after those.
    const fresh = await guest.auth.biometricChallenge({ keyId: device.keyId });
    expect(await guest.auth.biometricSignIn({ keyId: device.keyId, challenge: fresh.challenge, signature: signed(device.privateKey, fresh.challenge) }))
      .toMatchObject({ id: user.id });
  });

  it("says a key turned off is off, so the phone can forget it", async () => {
    const user = await account("off");
    const device = phone();
    const me = appRouter.createCaller(contextFor(user));
    await me.auth.biometricRegister({ keyId: device.keyId, publicKey: device.publicKey });
    const guest = appRouter.createCaller(contextFor(null, [], "10.2.0.4"));
    const { challenge } = await guest.auth.biometricChallenge({ keyId: device.keyId });

    expect(await me.auth.biometricRemove({ keyId: device.keyId })).toEqual({ removed: true });
    expect((await me.auth.biometricKeys()).keys).toEqual([]);
    await expect(guest.auth.biometricSignIn({ keyId: device.keyId, challenge, signature: signed(device.privateKey, challenge) }))
      .rejects.toMatchObject({ code: "NOT_FOUND", message: "auth.faceIdOff" });
    expect((await guest.auth.biometricChallenge({ keyId: device.keyId })).active).toBe(false);
  });

  it("goes with the account when it is deleted", async () => {
    const user = await account("gone");
    const device = phone();
    await appRouter.createCaller(contextFor(user)).auth.biometricRegister({ keyId: device.keyId, publicKey: device.publicKey });
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(biometricKeys).where(eq(biometricKeys.keyId, device.keyId))).toEqual([]);
  });

  it("never lets one account take over another's key, nor remove it", async () => {
    const owner = await account("owner");
    const other = await account("other");
    const device = phone();
    await appRouter.createCaller(contextFor(owner)).auth.biometricRegister({ keyId: device.keyId, publicKey: device.publicKey });
    const imposter = phone();
    await expect(appRouter.createCaller(contextFor(other)).auth.biometricRegister({ keyId: device.keyId, publicKey: imposter.publicKey }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "auth.faceIdBadKey" });
    expect(await appRouter.createCaller(contextFor(other)).auth.biometricRemove({ keyId: device.keyId })).toEqual({ removed: false });
    const [row] = await db.select().from(biometricKeys).where(eq(biometricKeys.keyId, device.keyId));
    expect(row.userId).toBe(owner.id);
    expect(row.publicKey).toBe(device.publicKey);
  });

  it("sets the same phone up again under its id, replacing the key", async () => {
    const user = await account("again");
    const first = phone();
    const me = appRouter.createCaller(contextFor(user));
    await me.auth.biometricRegister({ keyId: first.keyId, publicKey: first.publicKey });
    const remade = { ...phone(), keyId: first.keyId };
    await me.auth.biometricRegister({ keyId: remade.keyId, publicKey: remade.publicKey });
    expect((await me.auth.biometricKeys()).keys.length).toBe(1);

    const guest = appRouter.createCaller(contextFor(null, [], "10.2.0.5"));
    const old = await guest.auth.biometricChallenge({ keyId: first.keyId });
    await expect(guest.auth.biometricSignIn({ keyId: first.keyId, challenge: old.challenge, signature: signed(first.privateKey, old.challenge) }))
      .rejects.toMatchObject({ message: "auth.faceIdFailed" });
    const now = await guest.auth.biometricChallenge({ keyId: first.keyId });
    expect(await guest.auth.biometricSignIn({ keyId: first.keyId, challenge: now.challenge, signature: signed(remade.privateKey, now.challenge) }))
      .toMatchObject({ id: user.id });
  });

  it("refuses a key that is not a P-256 point, and an account already on its tenth phone", async () => {
    const user = await account("many");
    const me = appRouter.createCaller(contextFor(user));
    await expect(me.auth.biometricRegister({ keyId: phone().keyId, publicKey: Buffer.alloc(65, 4).toString("base64") }))
      .rejects.toMatchObject({ message: "auth.faceIdBadKey" });
    for (let i = 0; i < MAX_BIOMETRIC_KEYS; i += 1) {
      const device = phone();
      await me.auth.biometricRegister({ keyId: device.keyId, publicKey: device.publicKey, deviceName: `Phone ${i}` });
    }
    const eleventh = phone();
    await expect(me.auth.biometricRegister({ keyId: eleventh.keyId, publicKey: eleventh.publicKey }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "auth.faceIdTooMany" });
    expect((await me.auth.biometricKeys()).keys.length).toBe(MAX_BIOMETRIC_KEYS);
  });

  it("needs an account to set a phone up", async () => {
    const device = phone();
    await expect(appRouter.createCaller(contextFor(null)).auth.biometricRegister({ keyId: device.keyId, publicKey: device.publicKey }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("is closed, not broken, before migration 0078 is pasted", async () => {
    const user = await account("early");
    const device = phone();
    const me = appRouter.createCaller(contextFor(user));
    await me.auth.biometricRegister({ keyId: device.keyId, publicKey: device.publicKey });
    await db.execute(sql`alter table biometric_keys rename to biometric_keys_away`);
    try {
      expect(await me.auth.biometricKeys()).toEqual({ ready: false, keys: [] });
      await expect(me.auth.biometricRegister({ keyId: phone().keyId, publicKey: phone().publicKey }))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "auth.faceIdUnavailable" });
      expect(await me.auth.biometricRemove({ keyId: device.keyId })).toEqual({ removed: false });
      const guest = appRouter.createCaller(contextFor(null, [], "10.2.0.6"));
      const { challenge, active } = await guest.auth.biometricChallenge({ keyId: device.keyId });
      expect(active).toBe(false);
      await expect(guest.auth.biometricSignIn({ keyId: device.keyId, challenge, signature: signed(device.privateKey, challenge) }))
        .rejects.toMatchObject({ code: "NOT_FOUND", message: "auth.faceIdOff" });
    } finally {
      await db.execute(sql`alter table biometric_keys_away rename to biometric_keys`);
    }
    const [row] = await db.select().from(biometricKeys).where(and(eq(biometricKeys.keyId, device.keyId), eq(biometricKeys.userId, user.id)));
    expect(row).toBeDefined();
  });
});
