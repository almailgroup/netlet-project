/**
 * Pulling manufacturer images (3.1.10), the server half, against a fake
 * internet and a real Postgres.
 *
 * The rules are proved pure in `Shared/commerce/manufacturerImages.test.ts`.
 * What needs the server is that the address check sits on the lookup the
 * connection uses, that redirects are asked again, that the ceilings hold,
 * that only an image's own bytes make it an image, and that importing is a
 * store manager's act, counted per account.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import zlib from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authAttempts } from "../drizzle/schema.js";
import { MAX_IMPORTS_PER_ACCOUNT } from "../Shared/auth/rateLimit.js";
import type { Actor } from "../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let mod: typeof import("./manufacturerImages.js");

const manager: Actor = { kind: "vendor", userId: 5, vendorId: 2, role: "manager" };
const staff: Actor = { kind: "vendor", userId: 6, vendorId: 2, role: "staff" };
const shopper: Actor = { kind: "customer", userId: 7 } as unknown as Actor;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(60).fill(7)]);

type Reply = { status?: number; headers?: Record<string, string>; body?: Uint8Array | string };
/** The fake internet: a host's addresses, and what each URL answers. */
let dnsTable: Record<string, string[]>;
let pages: Record<string, Reply>;
let requested: string[];

function fakeRequest(url: string, options: { lookup: (host: string, opts: object, cb: (...args: unknown[]) => void) => void; headers: Record<string, string> }, onResponse: (response: unknown) => void) {
  const request = new EventEmitter() as EventEmitter & { end: () => void };
  request.end = () => {
    const { hostname } = new URL(url);
    /* Exactly what Node does: ask the lookup it was handed, then connect to its answer. */
    options.lookup(hostname, {}, (error: unknown) => {
      if (error) { request.emit("error", error); return; }
      requested.push(url);
      const reply = pages[url] ?? { status: 404 };
      const response = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
      response.statusCode = reply.status ?? 200;
      response.headers = reply.headers ?? {};
      onResponse(response);
      response.end(typeof reply.body === "string" ? Buffer.from(reply.body) : Buffer.from(reply.body ?? new Uint8Array()));
    });
  };
  return request;
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db.js")>()), getDb: async () => db }));
  mod = await import("./manufacturerImages.js");
  mod.transport.lookup = ((host: string, _options: unknown, callback: (error: Error | null, addresses: { address: string; family: number }[]) => void) => {
    const addresses = dnsTable[host];
    if (!addresses) return callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), []);
    callback(null, addresses.map(address => ({ address, family: address.includes(":") ? 6 : 4 })));
  }) as typeof mod.transport.lookup;
  mod.transport.request = fakeRequest as unknown as typeof mod.transport.request;
}, 60_000);

beforeEach(async () => {
  await db.delete(authAttempts);
  requested = [];
  dnsTable = { "maker.example": ["93.184.216.34"], "cdn.maker.example": ["93.184.216.35", "2606:4700::1"] };
  pages = {
    "https://maker.example/lamp": {
      headers: { "content-type": "text/html; charset=utf-8" },
      body: `<title>Lamp</title><script type="application/ld+json">{"@type":"Product","name":"Lamp 200","image":["https://cdn.maker.example/lamp.jpg"]}</script>`,
    },
    "https://cdn.maker.example/lamp.jpg": { headers: { "content-type": "image/jpeg" }, body: JPEG },
  };
});

describe("reading a manufacturer's page", () => {
  it("returns the product's own images and its name", async () => {
    expect(await mod.scanManufacturerPage(manager, "https://maker.example/lamp")).toEqual({
      page: "https://maker.example/lamp",
      title: "Lamp 200",
      candidates: [{ url: "https://cdn.maker.example/lamp.jpg", source: "product" }],
    });
  });

  it("follows a redirect, asks the new address again, and resolves the images against where it landed", async () => {
    dnsTable["www.maker.example"] = ["93.184.216.36"];
    pages["https://maker.example/old"] = { status: 301, headers: { location: "https://www.maker.example/new" } };
    pages["https://www.maker.example/new"] = { headers: { "content-type": "text/html" }, body: `<meta property="og:image" content="/i/lamp.webp">` };
    const scanned = await mod.scanManufacturerPage(manager, "https://maker.example/old");
    expect(scanned).toMatchObject({ page: "https://www.maker.example/new", candidates: [{ url: "https://www.maker.example/i/lamp.webp", source: "share" }] });
  });

  it("decompresses a page the server compressed anyway", async () => {
    pages["https://maker.example/gz"] = { headers: { "content-type": "text/html", "content-encoding": "gzip" }, body: zlib.gzipSync(`<meta property="og:image" content="https://cdn.maker.example/z.jpg">`) };
    expect((await mod.scanManufacturerPage(manager, "https://maker.example/gz")).candidates).toHaveLength(1);
  });

  it("refuses what is not a page", async () => {
    pages["https://maker.example/feed"] = { headers: { "content-type": "application/json" }, body: "{}" };
    await expect(mod.scanManufacturerPage(manager, "https://maker.example/feed")).rejects.toMatchObject({ reason: "manufacturer.notAPage" });
  });
});

describe("never reaching inside", () => {
  it("refuses a name that resolves to any private address, before a byte is sent", async () => {
    dnsTable["evil.example"] = ["93.184.216.40", "169.254.169.254"];
    pages["https://evil.example/x"] = { headers: { "content-type": "text/html" }, body: "<title>metadata</title>" };
    await expect(mod.scanManufacturerPage(manager, "https://evil.example/x")).rejects.toMatchObject({ reason: "manufacturer.unreachable" });
    dnsTable["rebind.example"] = ["::ffff:127.0.0.1"];
    await expect(mod.scanManufacturerPage(manager, "https://rebind.example/x")).rejects.toMatchObject({ reason: "manufacturer.unreachable" });
    expect(requested).toEqual([]);
  });

  it("asks every redirect the same questions, and stops after three", async () => {
    pages["https://maker.example/to-local"] = { status: 302, headers: { location: "https://127.0.0.1/admin" } };
    await expect(mod.scanManufacturerPage(manager, "https://maker.example/to-local")).rejects.toMatchObject({ reason: "manufacturer.unreachable" });
    pages["https://maker.example/to-http"] = { status: 302, headers: { location: "http://maker.example/lamp" } };
    await expect(mod.scanManufacturerPage(manager, "https://maker.example/to-http")).rejects.toMatchObject({ reason: "manufacturer.unreachable" });
    for (let i = 0; i < 5; i += 1) pages[`https://maker.example/r${i}`] = { status: 307, headers: { location: `/r${i + 1}` } };
    await expect(mod.scanManufacturerPage(manager, "https://maker.example/r0")).rejects.toMatchObject({ reason: "manufacturer.unreachable" });
    expect(requested.filter(url => url.includes("/r"))).toHaveLength(4);
    expect(requested.some(url => url.startsWith("http:") || url.includes("127.0.0.1"))).toBe(false);
  });

  it("refuses a URL the rules refuse without looking anything up", async () => {
    await expect(mod.scanManufacturerPage(manager, "http://maker.example/lamp")).rejects.toMatchObject({ reason: "manufacturer.notHttps" });
    await expect(mod.scanManufacturerPage(manager, "https://10.0.0.1/")).rejects.toMatchObject({ reason: "manufacturer.badUrl" });
    expect(requested).toEqual([]);
  });
});

describe("fetching one image", () => {
  it("passes an image by its bytes, and refuses one that only claims to be", async () => {
    expect(await mod.fetchManufacturerImage(manager, "https://cdn.maker.example/lamp.jpg")).toMatchObject({ type: "image/jpeg" });
    pages["https://cdn.maker.example/x.svg"] = { headers: { "content-type": "image/jpeg" }, body: "<svg><script>alert(1)</script></svg>" + " ".repeat(40) };
    await expect(mod.fetchManufacturerImage(manager, "https://cdn.maker.example/x.svg")).rejects.toMatchObject({ reason: "manufacturer.notAnImage" });
  });

  it("stops reading past the ceiling, declared or not", async () => {
    const big = new Uint8Array(8_000_001);
    big.set(JPEG.slice(0, 4));
    pages["https://cdn.maker.example/big.jpg"] = { headers: { "content-type": "image/jpeg" }, body: big };
    await expect(mod.fetchManufacturerImage(manager, "https://cdn.maker.example/big.jpg")).rejects.toMatchObject({ reason: "manufacturer.tooLarge" });
    pages["https://cdn.maker.example/liar.jpg"] = { headers: { "content-type": "image/jpeg", "content-length": "99999999" }, body: JPEG };
    await expect(mod.fetchManufacturerImage(manager, "https://cdn.maker.example/liar.jpg")).rejects.toMatchObject({ reason: "manufacturer.tooLarge" });
    /* A bomb: small compressed, huge inflated. */
    pages["https://maker.example/bomb"] = { headers: { "content-type": "text/html", "content-encoding": "gzip" }, body: zlib.gzipSync(Buffer.alloc(3_000_000, 32)) };
    await expect(mod.scanManufacturerPage(manager, "https://maker.example/bomb")).rejects.toMatchObject({ reason: "manufacturer.tooLarge" });
  });

  it("says unreachable for a page that is not there", async () => {
    await expect(mod.fetchManufacturerImage(manager, "https://cdn.maker.example/missing.jpg")).rejects.toMatchObject({ reason: "manufacturer.unreachable" });
    await expect(mod.fetchManufacturerImage(manager, "https://nowhere.example/a.jpg")).rejects.toMatchObject({ reason: "manufacturer.unreachable" });
  });
});

describe("who may, and how often", () => {
  it("is a store manager's act", async () => {
    await expect(mod.scanManufacturerPage(staff, "https://maker.example/lamp")).rejects.toMatchObject({ reason: "media.notAllowed" });
    await expect(mod.fetchManufacturerImage(shopper, "https://cdn.maker.example/lamp.jpg")).rejects.toMatchObject({ reason: "media.notAllowed" });
    expect(requested).toEqual([]);
  });

  it("counts every fetch per account, refused ones included, and stops at the ceiling", async () => {
    await db.insert(authAttempts).values(Array.from({ length: MAX_IMPORTS_PER_ACCOUNT - 1 }, () => ({ bucket: "user:5", kind: "imageImport" })));
    await expect(mod.fetchManufacturerImage(manager, "https://cdn.maker.example/missing.jpg")).rejects.toMatchObject({ reason: "manufacturer.unreachable" });
    await expect(mod.scanManufacturerPage(manager, "https://maker.example/lamp")).rejects.toMatchObject({ reason: "manufacturer.tooMany" });
    /* Another account is untouched. */
    await expect(mod.scanManufacturerPage({ ...manager, userId: 9 }, "https://maker.example/lamp")).resolves.toMatchObject({ title: "Lamp 200" });
  });
});
