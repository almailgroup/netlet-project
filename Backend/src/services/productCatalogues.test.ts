/**
 * A product's catalogues against a real Postgres: a file in one part and in
 * two, the store's publish rule, NetLet's review, who may add, read and
 * remove one, what a shopper is shown, the ceilings, and that the section is
 * closed, not broken, before migration 0082 is pasted.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, authAttempts, productCatalogues, products, users, vendorMembers, vendors } from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";
import { CATALOGUE_PART_BYTES, MAX_CATALOGUES_PER_PRODUCT, MAX_CATALOGUE_BYTES, MAX_CATALOGUE_UPLOADS_PER_HOUR } from "../../../Shared/inventory/productCatalogues.js";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let catalogues: typeof import("./productCatalogues.js");
let audit: typeof import("./audit.js");
const ids = { admin: 0, owner: 0, manager: 0, staff: 0, rival: 0, acme: 0, trusted: 0, other: 0, lamp: 0, sofa: 0, draft: 0 };

/** A PDF of `size` bytes: its header, filler, and its end marker. */
function pdf(size = 200, end = "\n%%EOF\n"): Uint8Array {
  const head = new TextEncoder().encode("%PDF-1.7\n");
  const tail = new TextEncoder().encode(end);
  const out = new Uint8Array(size);
  out.fill(0x20);
  out.set(head, 0);
  out.set(tail, size - tail.length);
  return out;
}
const upload = (bytes: Uint8Array, extra: Record<string, unknown> = {}) => ({
  sizeBytes: bytes.length,
  fileName: "Lamp brochure.pdf",
  declaredType: "application/pdf",
  bytes: bytes.subarray(0, Math.min(bytes.length, CATALOGUE_PART_BYTES)),
  ...extra,
});

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const name of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, name), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db.js")>()), getDb: async () => db }));
  catalogues = await import("./productCatalogues.js");
  audit = await import("./audit.js");
  ids.admin = (await db.insert(users).values({ email: "admin@netlet.test", name: "Nadia Admin", role: "admin" }).returning())[0].id;
  ids.owner = (await db.insert(users).values({ email: "owner@acme.test", name: "Omar Owner" }).returning())[0].id;
  ids.manager = (await db.insert(users).values({ email: "manager@acme.test" }).returning())[0].id;
  ids.staff = (await db.insert(users).values({ email: "staff@acme.test" }).returning())[0].id;
  ids.rival = (await db.insert(users).values({ email: "owner@rival.test" }).returning())[0].id;
  ids.acme = (await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning())[0].id;
  ids.trusted = (await db.insert(vendors).values({ slug: "trusted", name: "Trusted", status: "approved", autoPublish: true }).returning())[0].id;
  ids.other = (await db.insert(vendors).values({ slug: "rival", name: "Rival", status: "approved" }).returning())[0].id;
  await db.insert(vendorMembers).values([
    { vendorId: ids.acme, userId: ids.owner, role: "owner" },
    { vendorId: ids.acme, userId: ids.manager, role: "manager" },
    { vendorId: ids.acme, userId: ids.staff, role: "staff" },
    { vendorId: ids.other, userId: ids.rival, role: "owner" },
    { vendorId: ids.trusted, userId: ids.rival, role: "owner" },
  ]);
  ids.lamp = (await db.insert(products).values({ vendorId: ids.acme, handle: "brass-lamp", title: "Brass lamp", status: "published" }).returning())[0].id;
  ids.sofa = (await db.insert(products).values({ vendorId: ids.trusted, handle: "sofa", title: "Sofa", status: "published" }).returning())[0].id;
  ids.draft = (await db.insert(products).values({ vendorId: ids.acme, handle: "draft-lamp", title: "Draft lamp", status: "draft" }).returning())[0].id;
}, 60_000);

beforeEach(async () => {
  await db.delete(productCatalogues);
  await db.delete(authAttempts);
  await db.delete(auditLog);
});

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.acme, role: "owner" });
const manager = (): Actor => ({ kind: "vendor", userId: ids.manager, vendorId: ids.acme, role: "manager" });
const staff = (): Actor => ({ kind: "vendor", userId: ids.staff, vendorId: ids.acme, role: "staff" });
const rival = (): Actor => ({ kind: "vendor", userId: ids.rival, vendorId: ids.other, role: "owner" });
const trusted = (): Actor => ({ kind: "vendor", userId: ids.rival, vendorId: ids.trusted, role: "owner" });
const shopper = (): Actor => ({ kind: "customer", userId: ids.staff });

describe("product catalogues", () => {
  it("go on the product page at once when NetLet adds one", async () => {
    const file = pdf();
    const done = await catalogues.startCatalogueUpload(admin(), ids.lamp, upload(file, { title: "  Lamp   brochure ", titleAr: "كتيّب المصباح", fileName: "../Lamp brochure.pdf.exe" }));
    expect(done).toMatchObject({ received: file.length, sizeBytes: file.length, status: "live" });
    const shown = await catalogues.cataloguesForProduct(ids.lamp);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: done.id, title: "Lamp brochure", titleAr: "كتيّب المصباح", fileName: "Lamp brochure.pdf.pdf", sizeBytes: file.length });
    /* A list never carries the file. */
    expect(Object.keys(shown[0])).not.toContain("bytes");
    /* Anybody may read it, a guest included, and it comes back whole. */
    const read = await catalogues.readCatalogue(null, done.id);
    expect(read).toMatchObject({ public: true, sizeBytes: file.length });
    expect(Array.from(read!.bytes)).toEqual(Array.from(file));
    /* The editor says NetLet added it. */
    const editor = await catalogues.cataloguesForEditor(owner(), ids.lamp);
    expect(editor).toMatchObject({ ready: true, goesLive: false, room: MAX_CATALOGUES_PER_PRODUCT - 1 });
    expect(editor.items[0]).toMatchObject({ status: "live", byNetlet: true });
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, "product.catalogue.add"));
    expect(row).toMatchObject({ subjectType: "product", subjectId: ids.lamp, vendorId: ids.acme });
  });

  it("from a store that publishes under review wait for NetLet, who approves or declines with a reason", async () => {
    const first = await catalogues.startCatalogueUpload(owner(), ids.lamp, upload(pdf()));
    expect(first.status).toBe("pending");
    expect(await catalogues.cataloguesForProduct(ids.lamp)).toEqual([]);
    /* Not to a guest or a rival; the store and NetLet may look. */
    expect(await catalogues.readCatalogue(null, first.id)).toBeNull();
    expect(await catalogues.readCatalogue(rival(), first.id)).toBeNull();
    expect(await catalogues.readCatalogue(staff(), first.id)).toMatchObject({ public: false });
    expect(await catalogues.readCatalogue(admin(), first.id)).toMatchObject({ public: false });
    expect(await catalogues.waitingCatalogueCount(admin())).toBe(1);
    expect((await catalogues.waitingCatalogues(admin()))[0]).toMatchObject({ id: first.id, productTitle: "Brass lamp", productHandle: "brass-lamp", store: "Acme" });
    /* The store's own change is counted with the sellers' others. */
    expect((await audit.sellerChanges({})).unseen).toBe(1);
    /* Only NetLet answers. */
    await expect(catalogues.waitingCatalogues(owner())).rejects.toThrow("FORBIDDEN:product.review");
    await expect(catalogues.decideCatalogue(owner(), first.id, { approve: true })).rejects.toThrow("FORBIDDEN:product.review");
    expect(await catalogues.decideCatalogue(admin(), first.id, { approve: true })).toEqual({ status: "live" });
    await expect(catalogues.decideCatalogue(admin(), first.id, { approve: true })).rejects.toMatchObject({ reason: "catalogue.notWaiting" });
    expect((await catalogues.cataloguesForProduct(ids.lamp)).map(card => card.id)).toEqual([first.id]);

    const second = await catalogues.startCatalogueUpload(manager(), ids.lamp, upload(pdf(300)));
    await expect(catalogues.decideCatalogue(admin(), second.id, { approve: false, note: "  " })).rejects.toMatchObject({ reason: "catalogue.noteNeeded" });
    expect(await catalogues.decideCatalogue(admin(), second.id, { approve: false, note: "Shows another shop's address" })).toEqual({ status: "declined" });
    const editor = await catalogues.cataloguesForEditor(manager(), ids.lamp);
    expect(editor.items.map(item => [item.id, item.status, item.reviewNote])).toEqual([
      [first.id, "live", null],
      [second.id, "declined", "Shows another shop's address"],
    ]);
    expect((await catalogues.cataloguesForProduct(ids.lamp)).map(card => card.id)).toEqual([first.id]);
  });

  it("from a store that publishes without review go live at once", async () => {
    expect((await catalogues.cataloguesForEditor(trusted(), ids.sofa)).goesLive).toBe(true);
    const done = await catalogues.startCatalogueUpload(trusted(), ids.sofa, upload(pdf()));
    expect(done.status).toBe("live");
  });

  it("come in parts, joined in order, and are read back in parts", async () => {
    const file = pdf(CATALOGUE_PART_BYTES + 1500);
    for (let at = 9; at < file.length - 10; at += 4096) file[at] = at % 251;
    const started = await catalogues.startCatalogueUpload(owner(), ids.lamp, upload(file));
    expect(started).toMatchObject({ received: CATALOGUE_PART_BYTES, status: "uploading" });
    /* Still coming: not on the page and not in the editor. */
    expect((await catalogues.cataloguesForEditor(owner(), ids.lamp)).items).toEqual([]);
    expect(await catalogues.readCatalogue(owner(), started.id)).toBeNull();
    const rest = file.subarray(CATALOGUE_PART_BYTES);
    /* Somebody else, a wrong offset and a wrong length change nothing. */
    await expect(catalogues.appendCataloguePart(manager(), started.id, { offset: CATALOGUE_PART_BYTES, bytes: rest })).rejects.toMatchObject({ reason: "catalogue.notFound" });
    await expect(catalogues.appendCataloguePart(owner(), started.id, { offset: 0, bytes: rest })).rejects.toMatchObject({ reason: "catalogue.partMismatch" });
    await expect(catalogues.appendCataloguePart(owner(), started.id, { offset: CATALOGUE_PART_BYTES, bytes: rest.subarray(1) })).rejects.toMatchObject({ reason: "catalogue.partMismatch" });
    const done = await catalogues.appendCataloguePart(owner(), started.id, { offset: CATALOGUE_PART_BYTES, bytes: rest });
    expect(done).toMatchObject({ received: file.length, status: "pending" });
    /* A part sent again once it is whole is refused, not appended. */
    await expect(catalogues.appendCataloguePart(owner(), started.id, { offset: CATALOGUE_PART_BYTES, bytes: rest })).rejects.toMatchObject({ reason: "catalogue.notFound" });
    const whole = await catalogues.readCatalogue(admin(), started.id);
    expect(whole!.bytes.length).toBe(file.length);
    expect(Buffer.from(whole!.bytes).equals(Buffer.from(file))).toBe(true);
    const zero = await catalogues.readCatalogue(admin(), started.id, 0);
    const one = await catalogues.readCatalogue(admin(), started.id, 1);
    expect(zero!.bytes.length).toBe(CATALOGUE_PART_BYTES);
    expect(Buffer.concat([zero!.bytes, one!.bytes]).equals(Buffer.from(file))).toBe(true);
    expect(one!.sizeBytes).toBe(file.length);
    expect(await catalogues.readCatalogue(admin(), started.id, 2)).toBeNull();
  });

  it("refuse what is not a whole PDF of at most 5 MB, and a title carrying contact details", async () => {
    await expect(catalogues.startCatalogueUpload(owner(), ids.lamp, upload(new TextEncoder().encode("<html>hello</html>")))).rejects.toMatchObject({ reason: "catalogue.notPdf" });
    await expect(catalogues.startCatalogueUpload(owner(), ids.lamp, upload(pdf(), { declaredType: "text/html" }))).rejects.toMatchObject({ reason: "catalogue.notPdf" });
    await expect(catalogues.startCatalogueUpload(owner(), ids.lamp, upload(pdf(), { sizeBytes: MAX_CATALOGUE_BYTES + 1 }))).rejects.toMatchObject({ reason: "catalogue.tooLarge" });
    await expect(catalogues.startCatalogueUpload(owner(), ids.lamp, upload(pdf(), { sizeBytes: 0 }))).rejects.toMatchObject({ reason: "catalogue.empty" });
    /* The first part is the size it says, or the whole file. */
    await expect(catalogues.startCatalogueUpload(owner(), ids.lamp, upload(pdf(), { sizeBytes: 900 }))).rejects.toMatchObject({ reason: "catalogue.partMismatch" });
    await expect(catalogues.startCatalogueUpload(owner(), ids.lamp, upload(pdf(), { title: "Call 99887766" }))).rejects.toMatchObject({ reason: "catalogue.offPlatform" });
    /* Cut short: thrown away, and said so. */
    await expect(catalogues.startCatalogueUpload(owner(), ids.lamp, upload(pdf(200, "\nendobj\n")))).rejects.toMatchObject({ reason: "catalogue.cutShort" });
    expect(await db.select({ id: productCatalogues.id }).from(productCatalogues)).toEqual([]);
  });

  it("are nobody else's: not staff's, a rival's or a shopper's", async () => {
    const saved = await catalogues.startCatalogueUpload(owner(), ids.lamp, upload(pdf()));
    for (const actor of [staff(), rival(), shopper()]) {
      await expect(catalogues.startCatalogueUpload(actor, ids.lamp, upload(pdf()))).rejects.toMatchObject({ reason: "catalogue.notFound" });
      await expect(catalogues.cataloguesForEditor(actor, ids.lamp)).rejects.toMatchObject({ reason: "catalogue.notFound" });
      await expect(catalogues.removeCatalogue(actor, saved.id)).rejects.toMatchObject({ reason: "catalogue.notFound" });
    }
    await expect(catalogues.startCatalogueUpload(admin(), 999_999, upload(pdf()))).rejects.toMatchObject({ reason: "catalogue.notFound" });
    expect(await catalogues.storeOfCatalogue(saved.id)).toBe(ids.acme);
    expect(await catalogues.storeOfProduct(ids.lamp)).toBe(ids.acme);
    expect(await catalogues.storeOfCatalogue(999_999)).toBeNull();
    /* The store's owner takes it off, and the trail says so. */
    expect(await catalogues.removeCatalogue(owner(), saved.id)).toEqual({ productId: ids.lamp });
    await expect(catalogues.removeCatalogue(owner(), saved.id)).rejects.toMatchObject({ reason: "catalogue.notFound" });
    expect(await db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.action, "product.catalogue.remove"))).toHaveLength(1);
  });

  it("are shown only while the product is", async () => {
    const saved = await catalogues.startCatalogueUpload(admin(), ids.draft, upload(pdf()));
    expect(saved.status).toBe("live");
    expect(await catalogues.cataloguesForProduct(ids.draft)).toEqual([]);
    expect(await catalogues.readCatalogue(null, saved.id)).toBeNull();
    expect(await catalogues.readCatalogue(owner(), saved.id)).toMatchObject({ public: false });
  });

  it("hold to five a product and thirty uploads an hour, and forget an upload that stopped", async () => {
    for (let n = 0; n < MAX_CATALOGUES_PER_PRODUCT; n += 1) await catalogues.startCatalogueUpload(admin(), ids.sofa, upload(pdf(200 + n)));
    await expect(catalogues.startCatalogueUpload(admin(), ids.sofa, upload(pdf()))).rejects.toMatchObject({ reason: "catalogue.tooManyFiles" });
    expect((await catalogues.cataloguesForEditor(admin(), ids.sofa)).room).toBe(0);
    await db.delete(productCatalogues);

    await db.delete(authAttempts);
    await db.insert(authAttempts).values(Array.from({ length: MAX_CATALOGUE_UPLOADS_PER_HOUR }, () => ({ bucket: `user:${ids.owner}`, kind: "catalogue" })));
    await expect(catalogues.startCatalogueUpload(owner(), ids.lamp, upload(pdf()))).rejects.toMatchObject({ reason: "catalogue.tooMany" });
    await db.delete(authAttempts);

    const long = pdf(CATALOGUE_PART_BYTES + 10);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await catalogues.startCatalogueUpload(owner(), ids.lamp, upload(long), twoHoursAgo);
    expect(await db.select({ id: productCatalogues.id }).from(productCatalogues)).toHaveLength(1);
    await catalogues.cataloguesForEditor(owner(), ids.lamp);
    expect(await db.select({ id: productCatalogues.id }).from(productCatalogues)).toEqual([]);
  });

  it("are closed, not broken, before the table exists", async () => {
    await client.exec('ALTER TABLE "product_catalogues" RENAME TO "product_catalogues_away"');
    try {
      expect(await catalogues.cataloguesForProduct(ids.lamp)).toEqual([]);
      expect(await catalogues.cataloguesForEditor(owner(), ids.lamp)).toMatchObject({ ready: false, items: [] });
      await expect(catalogues.startCatalogueUpload(owner(), ids.lamp, upload(pdf()))).rejects.toMatchObject({ reason: "catalogue.unavailable" });
      expect(await catalogues.waitingCatalogueCount(admin())).toBe(0);
      expect(await catalogues.readCatalogue(null, 1)).toBeNull();
    } finally {
      await client.exec('ALTER TABLE "product_catalogues_away" RENAME TO "product_catalogues"');
    }
  });
});
