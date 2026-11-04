/**
 * A product's photos copied onto NetLet, against a real Postgres and a fake
 * internet (the maker's-page tests' seam).
 *
 * What matters: it names a gallery photo and never an address, so only
 * somebody who may edit that product can ask, and only about a photo still on
 * another site; the copy is stored and the gallery row moved in one
 * transaction, with the old address in the predicate; and the hourly ceiling.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authAttempts, mediaFiles, productImages, products, users, vendors } from "../../database/schema.js";
import { MAX_PHOTO_COPIES_PER_HOUR } from "../../../Shared/commerce/media.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let copies: typeof import("./photoCopies.js");
const ids = { manager: 0, other: 0, acme: 0, rival: 0, product: 0, rivalProduct: 0 };

/** A baseline JPEG header for a 1200 × 900 photo, which is all `sniffImage` reads. */
const JPEG = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x04, 0xb0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);
const ORIGINAL = "https://shop.example/rings/ring.jpg";

const manager = (): Actor => ({ kind: "vendor", userId: ids.manager, vendorId: ids.acme, role: "manager" });
const otherStore = (): Actor => ({ kind: "vendor", userId: ids.other, vendorId: ids.rival, role: "owner" });
const shopper = (): Actor => ({ kind: "customer", userId: ids.other });

let requested: string[];

function fakeRequest(url: string, options: { lookup: (host: string, opts: object, cb: (...args: unknown[]) => void) => void }, onResponse: (response: unknown) => void) {
  const request = new EventEmitter() as EventEmitter & { end: () => void };
  request.end = () => {
    options.lookup(new URL(url).hostname, {}, (error: unknown) => {
      if (error) { request.emit("error", error); return; }
      requested.push(url);
      const response = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
      response.statusCode = 200;
      response.headers = { "content-type": "image/jpeg" };
      onResponse(response);
      response.end(Buffer.from(JPEG));
    });
  };
  return request;
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
  const internet = await import("./manufacturerImages.js");
  internet.transport.lookup = ((host: string, _options: unknown, callback: (error: Error | null, addresses: { address: string; family: number }[]) => void) => {
    if (host !== "shop.example") return callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), []);
    callback(null, [{ address: "93.184.216.34", family: 4 }]);
  }) as typeof internet.transport.lookup;
  internet.transport.request = fakeRequest as unknown as typeof internet.transport.request;
  copies = await import("./photoCopies.js");

  const [a] = await db.insert(users).values({ email: "manager@acme.test" }).returning();
  const [b] = await db.insert(users).values({ email: "owner@rival.test" }).returning();
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [rival] = await db.insert(vendors).values({ slug: "rival", name: "Rival", status: "approved" }).returning();
  const [product] = await db.insert(products).values({ vendorId: acme.id, handle: "ring", title: "Ring", status: "published" }).returning();
  const [rivalProduct] = await db.insert(products).values({ vendorId: rival.id, handle: "rival-ring", title: "Rival ring", status: "published" }).returning();
  Object.assign(ids, { manager: a.id, other: b.id, acme: acme.id, rival: rival.id, product: product.id, rivalProduct: rivalProduct.id });
}, 60_000);

beforeEach(async () => {
  requested = [];
  await db.delete(authAttempts);
  await db.delete(productImages);
  await db.delete(mediaFiles);
});

async function photo(url = ORIGINAL, productId = ids.product, kind: "image" | "video" = "image") {
  const [row] = await db.insert(productImages).values({ productId, url, position: 0, kind }).returning();
  return row.id;
}

describe("copying a gallery photo onto NetLet", () => {
  it("fetches the original by the gallery photo's id, stores the copy and points the gallery at it", async () => {
    const id = await photo();
    const original = await copies.fetchPhotoToCopy(manager(), id);
    expect(original.type).toBe("image/jpeg");
    expect(requested).toEqual([ORIGINAL]);

    const saved = await copies.copyPhoto(manager(), id, JPEG, "image/jpeg");
    expect(saved.url).toMatch(/^\/media\/[A-Za-z0-9_-]{24}\.jpg$/);
    const [row] = await db.select().from(productImages).where(eq(productImages.id, id));
    expect(row.url).toBe(saved.url);
    const [file] = await db.select().from(mediaFiles);
    /* The store's file, and where it came from. */
    expect(file).toMatchObject({ vendorId: ids.acme, uploadedBy: ids.manager, sourceUrl: ORIGINAL });
  });

  it("refuses another store's photo, and a shopper", async () => {
    const theirs = await photo(ORIGINAL, ids.rivalProduct);
    await expect(copies.fetchPhotoToCopy(manager(), theirs)).rejects.toMatchObject({ reason: "media.notAllowed" });
    await expect(copies.copyPhoto(manager(), theirs, JPEG, "image/jpeg")).rejects.toMatchObject({ reason: "media.notAllowed" });
    const mine = await photo();
    await expect(copies.fetchPhotoToCopy(shopper(), mine)).rejects.toMatchObject({ reason: "media.notAllowed" });
    await expect(copies.fetchPhotoToCopy(otherStore(), mine)).rejects.toMatchObject({ reason: "media.notAllowed" });
    expect(requested).toEqual([]);
  });

  it("leaves a photo already on NetLet, a video, and one that no longer exists", async () => {
    const own = await photo("/media/abcdefghijklmnopqrstuvwx.jpg");
    const video = await photo("https://shop.example/ring.mp4", ids.product, "video");
    for (const id of [own, video, 987654]) {
      await expect(copies.fetchPhotoToCopy(manager(), id)).rejects.toMatchObject({ reason: "media.copyGone" });
    }
    expect(requested).toEqual([]);
  });

  it("stores one file when two tabs copy the same photo, and none when it changed meanwhile", async () => {
    const id = await photo();
    await copies.copyPhoto(manager(), id, JPEG, "image/jpeg");
    await expect(copies.copyPhoto(manager(), id, JPEG, "image/jpeg")).rejects.toMatchObject({ reason: "media.copyGone" });
    expect(await db.select().from(mediaFiles)).toHaveLength(1);
  });

  it("holds the copy to an upload's rules, whatever the browser sent", async () => {
    const id = await photo();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(40).fill(0)]);
    await expect(copies.copyPhoto(manager(), id, png, "image/jpeg")).rejects.toBeInstanceOf(copies.PhotoCopyRefused);
    const [row] = await db.select().from(productImages).where(eq(productImages.id, id));
    expect(row.url).toBe(ORIGINAL);
    expect(await db.select().from(mediaFiles)).toHaveLength(0);
  });

  it("stops at the hourly ceiling, counted on the fetch", async () => {
    const id = await photo();
    await db.insert(authAttempts).values(Array.from({ length: MAX_PHOTO_COPIES_PER_HOUR }, () => ({ bucket: `user:${ids.manager}`, kind: "photoCopy" })));
    await expect(copies.fetchPhotoToCopy(manager(), id)).rejects.toMatchObject({ reason: "media.copyTooMany" });
    expect(requested).toEqual([]);
  });
});
