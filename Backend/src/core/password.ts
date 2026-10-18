/**
 * Password hashing on Node's own crypto primitives.
 *
 * scrypt is memory-hard and ships in the standard library, so NetLet gains
 * password auth without taking on bcrypt/argon2 — both of which mean a native
 * build step that tends to break on deploy.
 *
 * Stored format is self-describing: `scrypt$N$r$p$salt$hash`, all base64url.
 * Carrying the parameters in the string means the cost can be raised later
 * without invalidating existing passwords — verification reads whatever
 * parameters that hash was created with.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// promisify resolves to scrypt's 3-argument overload, which drops the options
// object the cost parameters live in. Typed explicitly so they are not silently
// ignored — without this the hash would use Node's defaults, not ours.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

/** OWASP's baseline for scrypt: ~64MB per hash at N=2^15, r=8, p=1. */
const PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** scrypt needs maxmem above roughly 128 * N * r, which exceeds Node's default. */
const MAX_MEM = 192 * PARAMS.N * PARAMS.r;

const b64 = (buffer: Buffer) => buffer.toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEM,
  });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${b64(salt)}$${b64(derived)}`;
}

/**
 * Constant-time comparison against a stored hash. Returns false rather than
 * throwing on a malformed record, so a corrupted row cannot 500 the login
 * endpoint — it simply fails to authenticate.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, salt, expected] = stored.split("$");
    if (scheme !== "scrypt") return false;

    const saltBuffer = Buffer.from(salt, "base64url");
    const expectedBuffer = Buffer.from(expected, "base64url");
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) {
      return false;
    }

    const derived = await scryptAsync(password.normalize("NFKC"), saltBuffer, expectedBuffer.length, {
      ...params,
      maxmem: 192 * params.N * params.r,
    });

    // Lengths must match before timingSafeEqual, which throws otherwise.
    return derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer);
  } catch {
    return false;
  }
}
