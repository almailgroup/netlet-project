import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("accepts the correct password and rejects a near miss", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", stored)).toBe(false);
  });

  it("salts every hash, so identical passwords do not collide", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("embeds its cost parameters so they can be raised without invalidating hashes", async () => {
    const [scheme, n, r, p] = (await hashPassword("x")).split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(32768);
    expect([Number(r), Number(p)]).toEqual([8, 1]);
  });

  it("verifies against the parameters stored with the hash, not today's defaults", async () => {
    // A hash written under a weaker cost must keep verifying after the cost is
    // raised, or every existing shopper is locked out by the upgrade.
    const legacy = "scrypt$16384$8$1$" + Buffer.from("0123456789abcdef").toString("base64url") + "$";
    // Build a genuine low-cost hash to compare against.
    const { scrypt } = await import("node:crypto");
    const { promisify } = await import("node:util");
    const derive = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
    const salt = Buffer.from("0123456789abcdef");
    const digest = await derive("legacy-secret", salt, 64, { N: 16384, r: 8, p: 1, maxmem: 192 * 16384 * 8 });
    expect(await verifyPassword("legacy-secret", legacy + digest.toString("base64url"))).toBe(true);
  });

  it("returns false rather than throwing on a malformed record", async () => {
    // A corrupted row must fail the login, not 500 the endpoint.
    for (const bad of ["", "not-a-hash", "scrypt$x$y$z$q$r", "bcrypt$2a$10$abc"]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });
});
