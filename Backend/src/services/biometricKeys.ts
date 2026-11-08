/**
 * Face ID sign-in keys, the database half (`Shared/auth/biometricKey.ts` is
 * the rule): the public half of the key each iPhone made in its Secure
 * Enclave, which account it signs in to, and the signature check.
 *
 * **Until migration 0078 is pasted it is closed, not broken**: a missing
 * table reads as no keys and a phone cannot set one up
 * (`auth.faceIdUnavailable`), so the code may be deployed first and the
 * sign-in form simply never offers Face ID.
 */
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { biometricKeys, users, type User } from "../../database/schema.js";
import { MAX_BIOMETRIC_KEYS, deviceNameOf } from "../../../Shared/auth/biometricKey.js";
import { isMissingTable } from "../core/describeError.js";
import { getDb } from "./db.js";

export class BiometricKeyError extends Error {}

/**
 * The phone's public key as `SecKeyCopyExternalRepresentation` gives it — an
 * uncompressed P-256 point, 65 bytes starting 0x04 — in base64; null for
 * anything else, so a malformed key is refused when it is offered rather than
 * failing every sign-in afterwards.
 */
export function publicKeyFrom(base64: string): KeyObject | null {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (bytes.length !== 65 || bytes[0] !== 0x04) return null;
  try {
    return createPublicKey({
      key: { kty: "EC", crv: "P-256", x: bytes.subarray(1, 33).toString("base64url"), y: bytes.subarray(33, 65).toString("base64url") },
      format: "jwk",
    });
  } catch {
    // Not a point on the curve.
    return null;
  }
}

/**
 * Whether `signature` (base64, DER, as `.ecdsaSignatureMessageX962SHA256`
 * makes it) is the phone's key signing `message`. Never throws.
 */
export function signatureValid(publicKey: string, message: string, signature: string): boolean {
  const key = publicKeyFrom(publicKey);
  if (!key) return false;
  try {
    return verify("sha256", Buffer.from(message, "utf-8"), { key, dsaEncoding: "der" }, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export type BiometricKeySummary = {
  keyId: string;
  deviceName: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

/** The phones this account has Face ID set up on, newest first; `ready` false before 0078. */
export async function biometricKeysFor(userId: number): Promise<{ ready: boolean; keys: BiometricKeySummary[] }> {
  const db = await getDb();
  if (!db) return { ready: false, keys: [] };
  try {
    const rows = await db
      .select({ keyId: biometricKeys.keyId, deviceName: biometricKeys.deviceName, createdAt: biometricKeys.createdAt, lastUsedAt: biometricKeys.lastUsedAt })
      .from(biometricKeys)
      .where(eq(biometricKeys.userId, userId))
      .orderBy(asc(biometricKeys.createdAt), asc(biometricKeys.id));
    return { ready: true, keys: rows.reverse() };
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, keys: [] };
    throw error;
  }
}

/**
 * Sets Face ID up on a phone for this account. A key id already on the
 * account is replaced (the phone made a new key under it); one held by
 * another account is refused, as is a key that is not a P-256 point and an
 * account already at `MAX_BIOMETRIC_KEYS` phones.
 */
export async function registerBiometricKey(
  userId: number,
  input: { keyId: string; publicKey: string; deviceName?: string | null },
): Promise<void> {
  if (!publicKeyFrom(input.publicKey)) throw new BiometricKeyError("auth.faceIdBadKey");
  const db = await getDb();
  if (!db) throw new BiometricKeyError("auth.faceIdUnavailable");
  try {
    await db.transaction(async tx => {
      const [held] = await tx.select({ userId: biometricKeys.userId }).from(biometricKeys).where(eq(biometricKeys.keyId, input.keyId)).limit(1);
      if (held && held.userId !== userId) throw new BiometricKeyError("auth.faceIdBadKey");
      if (held) {
        await tx
          .update(biometricKeys)
          .set({ publicKey: input.publicKey, deviceName: deviceNameOf(input.deviceName), createdAt: new Date(), lastUsedAt: null })
          .where(eq(biometricKeys.keyId, input.keyId));
        return;
      }
      const [{ n }] = await tx.select({ n: count() }).from(biometricKeys).where(eq(biometricKeys.userId, userId));
      if (n >= MAX_BIOMETRIC_KEYS) throw new BiometricKeyError("auth.faceIdTooMany");
      await tx.insert(biometricKeys).values({ userId, keyId: input.keyId, publicKey: input.publicKey, deviceName: deviceNameOf(input.deviceName) });
    });
  } catch (error) {
    if (error instanceof BiometricKeyError) throw error;
    if (isMissingTable(error)) throw new BiometricKeyError("auth.faceIdUnavailable");
    throw error;
  }
}

/** Turns Face ID off for one of this account's phones. False when it was not this account's. */
export async function removeBiometricKey(userId: number, keyId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const gone = await db
      .delete(biometricKeys)
      .where(and(eq(biometricKeys.userId, userId), eq(biometricKeys.keyId, keyId)))
      .returning({ id: biometricKeys.id });
    return gone.length > 0;
  } catch (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
}

/**
 * The account and public key a phone's key id names, or null — none, or no
 * table yet. The account is read here rather than through `db.ts`, whose
 * functions call a `getDb` nothing outside can redirect.
 */
export async function biometricKeyOwner(keyId: string): Promise<{ user: User; publicKey: string } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select({ user: users, publicKey: biometricKeys.publicKey })
      .from(biometricKeys)
      .innerJoin(users, eq(users.id, biometricKeys.userId))
      .where(eq(biometricKeys.keyId, keyId))
      .limit(1);
    return row ?? null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

/** Notes that a phone's key signed in, for the list on "Your profile". */
export async function touchBiometricKey(keyId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(biometricKeys).set({ lastUsedAt: new Date() }).where(eq(biometricKeys.keyId, keyId));
}
