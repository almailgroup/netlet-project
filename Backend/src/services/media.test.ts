/**
 * Uploaded photos against a real Postgres (3.3.4).
 *
 * What a file is and the fixes are proved pure in `Shared/commerce/media.test.ts`.
 * What needs a database is who may store one, that the bytes come back exactly
 * under the name they were stored with and no other, and the hourly ceiling.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaFiles, users, vendors } from "../../database/schema.js";
import { MAX_UPLOADS_PER_HOUR } from "../../../Shared/commerce/media.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let media: typeof import("./media.js");
const ids = { manager: 0, shopper: 0, acme: 0 };

/** A baseline JPEG header for a 1200 × 900 photo, which is all `sniffImage` reads. */
const JPEG = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x04, 0xb0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);

const manager = (): Actor => ({ kind: "vendor", userId: ids.manager, vendorId: ids.acme, role: "manager" });
const shopper = (): Actor => ({ kind: "customer", userId: ids.shopper });

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
  media = await import("./media.js");
  const [a] = await db.insert(users).values({ email: "manager@acme.test" }).returning();
  const [b] = await db.insert(users).values({ email: "shopper@shop.test" }).returning();
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  ids.manager = a.id; ids.shopper = b.id; ids.acme = acme.id;
}, 60_000);

beforeEach(async () => {
  await db.delete(mediaFiles);
});

describe("storing a photo", () => {
  it("keeps the bytes under a random name and gives them back exactly", async () => {
    const saved = await media.saveUpload(manager(), JPEG, "image/jpeg");
    expect(saved).toMatchObject({ width: 1200, height: 900 });
    expect(saved.url).toMatch(/^\/media\/[A-Za-z0-9_-]{24}\.jpg$/);
    const read = await media.readMedia(saved.url.slice("/media/".length));
    expect(read?.contentType).toBe("image/jpeg");
    expect(Buffer.from(read!.bytes).equals(Buffer.from(JPEG))).toBe(true);
    const [row] = await db.select().from(mediaFiles);
    expect(row).toMatchObject({ vendorId: ids.acme, uploadedBy: ids.manager, byteSize: JPEG.length });
  });

  it("answers to its own name only", async () => {
    const saved = await media.saveUpload(manager(), JPEG, "image/jpeg");
    const id = saved.url.slice("/media/".length, -".jpg".length);
    expect(await media.readMedia(`${id}.webp`)).toBeNull();
    expect(await media.readMedia(`${id}.jpg/../x`)).toBeNull();
    expect(await media.readMedia("AAAAAAAAAAAAAAAAAAAAAAAA.jpg")).toBeNull();
  });

  it("is a catalogue act: a shopper may not", async () => {
    await expect(media.saveUpload(shopper(), JPEG, "image/jpeg")).rejects.toMatchObject({ reason: "media.notAllowed" });
  });

  it("trusts the bytes, not the label", async () => {
    await expect(media.saveUpload(manager(), JPEG, "image/webp")).rejects.toMatchObject({ reason: "media.wrongType" });
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    await expect(media.saveUpload(manager(), svg, "image/jpeg")).rejects.toMatchObject({ reason: "media.notAnImage" });
    expect(await db.select().from(mediaFiles)).toHaveLength(0);
  });

  it("stops at the hourly ceiling, per account", async () => {
    await db.insert(mediaFiles).values(Array.from({ length: MAX_UPLOADS_PER_HOUR }, (_, i) => ({
      id: `seed${String(i).padStart(20, "0")}`, uploadedBy: ids.manager, contentType: "image/jpeg", bytes: JPEG, width: 1200, height: 900, byteSize: JPEG.length,
    })));
    await expect(media.saveUpload(manager(), JPEG, "image/jpeg")).rejects.toMatchObject({ reason: "media.tooMany" });
    /* An hour later the window has moved on. */
    expect(await media.saveUpload(manager(), JPEG, "image/jpeg", null, new Date(Date.now() + 61 * 60_000))).toMatchObject({ width: 1200 });
  });
});
