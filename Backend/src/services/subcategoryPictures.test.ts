/**
 * The subcategories' pictures against a real Postgres: kept as one
 * `platform_settings` row each, only one of NetLet's own uploads that exists,
 * only for a subcategory the shop has, only by somebody who configures the
 * shop; taken off again; on the trail; and never read back as a setting.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, mediaFiles, platformSettings, users } from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let pictures: typeof import("./subcategoryPictures.js");
let settings: typeof import("./settings.js");
let admin: Actor;
let seller: Actor;
const FILE = "abcdefghijklmnopqrstuvwx";

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
  pictures = await import("./subcategoryPictures.js");
  settings = await import("./settings.js");
  const [owner] = await db.insert(users).values({ email: "admin@example.test", role: "admin" }).returning();
  const [store] = await db.insert(users).values({ email: "store@example.test" }).returning();
  admin = { kind: "admin", userId: owner.id };
  seller = { kind: "vendor", userId: store.id, vendorId: 1, role: "owner" };
  await db.insert(mediaFiles).values({ id: FILE, uploadedBy: owner.id, contentType: "image/webp", bytes: new Uint8Array([1, 2, 3]), width: 384, height: 384, byteSize: 3 });
}, 60_000);

beforeEach(async () => {
  await db.delete(platformSettings);
  await db.delete(auditLog);
});

describe("subcategory pictures", () => {
  it("keeps one of NetLet's own uploads for a subcategory, and reads it back", async () => {
    expect(await pictures.subcategoryPictures()).toEqual({});
    const kept = await pictures.setSubcategoryPicture(admin, "electronics", "phones", `/media/${FILE}.webp`);
    expect(kept).toEqual({ "electronics/phones": `/media/${FILE}.webp` });
    expect(await pictures.subcategoryPictures()).toEqual(kept);
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, "subpic:electronics/phones"));
    expect(row.updatedBy).toBe(admin.userId);
    const trail = await db.select().from(auditLog);
    expect(trail.map(entry => entry.action)).toEqual(["subcategory.setPicture"]);
  });

  it("takes it off again", async () => {
    await pictures.setSubcategoryPicture(admin, "grocery", "pantry", `/media/${FILE}.webp`);
    expect(await pictures.setSubcategoryPicture(admin, "grocery", "pantry", null)).toEqual({});
    expect(await db.select().from(platformSettings)).toHaveLength(0);
  });

  it("refuses an address, an upload that does not exist and a subcategory the shop does not have", async () => {
    await expect(pictures.setSubcategoryPicture(admin, "electronics", "phones", "https://example.com/phone.png")).rejects.toMatchObject({ reason: "subcategoryPictures.badPicture" });
    await expect(pictures.setSubcategoryPicture(admin, "electronics", "phones", "/media/zzzzzzzzzzzzzzzzzzzzzzzz.webp")).rejects.toMatchObject({ reason: "subcategoryPictures.badPicture" });
    await expect(pictures.setSubcategoryPicture(admin, "electronics", "spaceships", `/media/${FILE}.webp`)).rejects.toMatchObject({ reason: "subcategoryPictures.notFound" });
    expect(await db.select().from(platformSettings)).toHaveLength(0);
  });

  it("is NetLet's to change, never a store's", async () => {
    await expect(pictures.setSubcategoryPicture(seller, "electronics", "phones", `/media/${FILE}.webp`)).rejects.toThrow(/FORBIDDEN/);
  });

  it("never reaches the settings page", async () => {
    await pictures.setSubcategoryPicture(admin, "electronics", "phones", `/media/${FILE}.webp`);
    const listed = await settings.listSettings(admin);
    expect(listed.some(entry => entry.key.startsWith("subpic:"))).toBe(false);
  });
});
