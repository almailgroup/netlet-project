/**
 * The profile photo (migration 0076) against a real Postgres: one per
 * account, replaced in place with a new version, removed, gone with the
 * account; the bytes decide what it is; and before the migration is pasted a
 * read is "not open yet" and a save says so without spending the hour.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authAttempts, profilePhotos, users } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let photo: typeof import("./profilePhoto.js");
const ids = { shopper: 0, other: 0 };

function webp(width: number, height: number, fill = 0): Uint8Array {
  const bytes = new Uint8Array(64).fill(fill);
  bytes.set([..."RIFF"].map(c => c.charCodeAt(0)), 0);
  bytes.set([..."WEBP"].map(c => c.charCodeAt(0)), 8);
  bytes.set([..."VP8X"].map(c => c.charCodeAt(0)), 12);
  const w = width - 1, h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return bytes;
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
  vi.doMock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db.js")>()), getDb: async () => db }));
  photo = await import("./profilePhoto.js");
  const [shopper] = await db.insert(users).values({ email: "shopper@example.test", name: "Noura" }).returning();
  const [other] = await db.insert(users).values({ email: "other@example.test" }).returning();
  Object.assign(ids, { shopper: shopper.id, other: other.id });
}, 60_000);

beforeEach(async () => {
  await db.delete(profilePhotos);
  await db.delete(authAttempts);
});

describe("a profile photo", () => {
  it("is none until one is set, then one per account, replaced with a new version", async () => {
    expect(await photo.photoFor(ids.shopper)).toEqual({ ready: true, url: null });
    const first = await photo.setProfilePhoto(ids.shopper, webp(512, 512, 1), "image/webp");
    expect(first.url).toMatch(new RegExp(`^/api/profile/photo/${ids.shopper}\\?v=\\d+$`));
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = await photo.setProfilePhoto(ids.shopper, webp(512, 512, 2), "image/webp");
    expect(second.url).not.toBe(first.url);
    expect(await db.select().from(profilePhotos)).toHaveLength(1);
    const read = await photo.readProfilePhoto(ids.shopper);
    expect(read?.contentType).toBe("image/webp");
    expect(read?.bytes[40]).toBe(2);
    /* Another account has none of it. */
    expect(await photo.readProfilePhoto(ids.other)).toBeNull();
    expect(await photo.photoFor(ids.other)).toEqual({ ready: true, url: null });
  });

  it("is refused by its own bytes, before the hour is spent", async () => {
    await expect(photo.setProfilePhoto(ids.shopper, webp(800, 600), "image/webp")).rejects.toMatchObject({ reason: "profilePhoto.notSquare" });
    await expect(photo.setProfilePhoto(ids.shopper, new TextEncoder().encode("<svg/>"), "image/webp")).rejects.toMatchObject({ reason: "media.notAnImage" });
    expect(await db.select().from(authAttempts)).toHaveLength(0);
  });

  it("stops after the hour's changes", async () => {
    const { MAX_PROFILE_PHOTOS_PER_HOUR } = await import("../../../Shared/commerce/profilePhoto.js");
    for (let i = 0; i < MAX_PROFILE_PHOTOS_PER_HOUR; i++) await photo.setProfilePhoto(ids.shopper, webp(512, 512), "image/webp");
    await expect(photo.setProfilePhoto(ids.shopper, webp(512, 512), "image/webp")).rejects.toMatchObject({ reason: "media.tooMany" });
  });

  it("is removed, and goes with the account", async () => {
    await photo.setProfilePhoto(ids.shopper, webp(512, 512), "image/webp");
    expect(await photo.removeProfilePhoto(ids.shopper)).toEqual({ ready: true, url: null });
    expect(await photo.readProfilePhoto(ids.shopper)).toBeNull();

    const [leaving] = await db.insert(users).values({ email: "leaving@example.test" }).returning();
    await photo.setProfilePhoto(leaving.id, webp(512, 512), "image/webp");
    await db.delete(users).where(eq(users.id, leaving.id));
    expect(await db.select().from(profilePhotos)).toHaveLength(0);
  });

  it("reads as not open yet before the migration, and a save says so without spending the hour", async () => {
    await db.execute("alter table profile_photos rename to profile_photos_away");
    try {
      expect(await photo.photoFor(ids.shopper)).toEqual({ ready: false, url: null });
      expect(await photo.readProfilePhoto(ids.shopper)).toBeNull();
      expect(await photo.removeProfilePhoto(ids.shopper)).toEqual({ ready: false, url: null });
      await expect(photo.setProfilePhoto(ids.shopper, webp(512, 512), "image/webp")).rejects.toMatchObject({ reason: "profilePhoto.unavailable" });
      expect(await db.select().from(authAttempts)).toHaveLength(0);
    } finally {
      await db.execute("alter table profile_photos_away rename to profile_photos");
    }
  });
});
