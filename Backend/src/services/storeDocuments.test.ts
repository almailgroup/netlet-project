/**
 * A store's documents against a real Postgres: who may add, list, read and
 * remove them; what a store is never shown; the ceilings; and that the
 * section is closed, not broken, before migration 0080 is pasted.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, authAttempts, users, vendorDocuments, vendorMembers, vendors } from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";
import { MAX_STORE_DOCUMENTS, MAX_STORE_DOCUMENT_UPLOADS_PER_HOUR } from "../../../Shared/inventory/storeDocuments.js";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let documents: typeof import("./storeDocuments.js");
let audit: typeof import("./audit.js");
const ids = { admin: 0, owner: 0, manager: 0, rival: 0, acme: 0, other: 0 };

const pdf = (text = "licence") => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF`);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const file = (extra: Record<string, unknown> = {}) => ({ kind: "trade_licence", fileName: "Licence 2026.pdf", declaredType: "application/pdf", bytes: pdf(), ...extra });

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
  documents = await import("./storeDocuments.js");
  audit = await import("./audit.js");
  ids.admin = (await db.insert(users).values({ email: "admin@netlet.test", name: "Nadia Admin", role: "admin" }).returning())[0].id;
  ids.owner = (await db.insert(users).values({ email: "owner@acme.test", name: "Omar Owner" }).returning())[0].id;
  ids.manager = (await db.insert(users).values({ email: "manager@acme.test" }).returning())[0].id;
  ids.rival = (await db.insert(users).values({ email: "owner@rival.test" }).returning())[0].id;
  ids.acme = (await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning())[0].id;
  ids.other = (await db.insert(vendors).values({ slug: "rival", name: "Rival", status: "approved" }).returning())[0].id;
  await db.insert(vendorMembers).values([
    { vendorId: ids.acme, userId: ids.owner, role: "owner" },
    { vendorId: ids.acme, userId: ids.manager, role: "manager" },
    { vendorId: ids.other, userId: ids.rival, role: "owner" },
  ]);
}, 60_000);

beforeEach(async () => {
  await db.delete(vendorDocuments);
  await db.delete(authAttempts);
  await db.delete(auditLog);
});

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.acme, role: "owner" });
const manager = (): Actor => ({ kind: "vendor", userId: ids.manager, vendorId: ids.acme, role: "manager" });
const rival = (): Actor => ({ kind: "vendor", userId: ids.rival, vendorId: ids.other, role: "owner" });
const shopper = (): Actor => ({ kind: "customer", userId: ids.manager });

describe("store documents", () => {
  it("are added by the store's owner and read by the owner and NetLet", async () => {
    const now = new Date("2026-11-11T09:00:00Z");
    const saved = await documents.uploadStoreDocument(owner(), ids.acme, file({ title: "  Trade   licence 2026 ", expiresOn: "2026-11-30", fileName: "../../Licence 2026.pdf.exe" }), now);
    expect(saved).toMatchObject({
      kind: "trade_licence",
      title: "Trade licence 2026",
      fileName: "Licence 2026.pdf.pdf",
      contentType: "application/pdf",
      expiresOn: "2026-11-30",
      expiry: { kind: "soon", days: 19 },
      netletOnly: false,
      by: "store",
      uploader: "Omar Owner",
      mayRemove: true,
    });
    const mine = await documents.listStoreDocuments(owner(), ids.acme, now);
    expect(mine).toMatchObject({ ready: true, netlet: false, room: MAX_STORE_DOCUMENTS - 1 });
    expect(mine.documents.map(document => document.id)).toEqual([saved.id]);
    /* A list never carries the file. */
    expect(Object.keys(mine.documents[0])).not.toContain("bytes");
    const theirs = await documents.listStoreDocuments(admin(), ids.acme, now);
    expect(theirs.netlet).toBe(true);
    expect(theirs.documents[0]).toMatchObject({ id: saved.id, by: "store", uploader: "Omar Owner", mayRemove: true });
    /* The bytes come back whole, to both. */
    expect(new TextDecoder().decode((await documents.readStoreDocument(owner(), saved.id))!.bytes)).toContain("%PDF-1.4");
    expect((await documents.readStoreDocument(admin(), saved.id))!.fileName).toBe("Licence 2026.pdf.pdf");
    /* And the trail says who added it, as what. */
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, "vendor.document.add"));
    expect(row).toMatchObject({ actorRole: "owner", actorEmail: "owner@acme.test", vendorId: ids.acme, subjectLabel: "Acme" });
    expect(row.after).toMatchObject({ documentId: saved.id, kind: "trade_licence", netletOnly: false });
    /* Which an administrator is told about with the sellers' other changes. */
    expect((await audit.sellerChanges({})).unseen).toBe(1);
  });

  it("are nobody else's: not a manager's, another store's or a shopper's", async () => {
    const saved = await documents.uploadStoreDocument(owner(), ids.acme, file());
    for (const actor of [manager(), rival(), shopper()]) {
      await expect(documents.listStoreDocuments(actor, ids.acme)).rejects.toThrow("FORBIDDEN:vendor.editProfile");
      await expect(documents.uploadStoreDocument(actor, ids.acme, file())).rejects.toThrow("FORBIDDEN:vendor.editProfile");
      /* The same answer as a number that names nothing. */
      expect(await documents.readStoreDocument(actor, saved.id)).toBeNull();
      await expect(documents.removeStoreDocument(actor, saved.id)).rejects.toMatchObject({ reason: "documents.notFound" });
    }
    expect(await documents.readStoreDocument(admin(), 999_999)).toBeNull();
    await expect(documents.removeStoreDocument(admin(), 999_999)).rejects.toMatchObject({ reason: "documents.notFound" });
    expect(await documents.storeOfDocument(saved.id)).toBe(ids.acme);
    expect(await documents.storeOfDocument(999_999)).toBeNull();
    /* A store that does not exist is not a 500. */
    await expect(documents.uploadStoreDocument(admin(), 999_999, file())).rejects.toMatchObject({ reason: "documents.notFound" });
  });

  it("keep a file marked NetLet only from the store altogether", async () => {
    const secret = await documents.uploadStoreDocument(admin(), ids.acme, file({ kind: "other", title: "Bank's note", netletOnly: true }));
    expect(secret).toMatchObject({ netletOnly: true, by: "netlet", uploader: "Nadia Admin" });
    const mine = await documents.listStoreDocuments(owner(), ids.acme);
    expect(mine.documents).toEqual([]);
    /* It still takes one of the store's places. */
    expect(mine.room).toBe(MAX_STORE_DOCUMENTS - 1);
    expect(await documents.readStoreDocument(owner(), secret.id)).toBeNull();
    await expect(documents.removeStoreDocument(owner(), secret.id)).rejects.toMatchObject({ reason: "documents.notFound" });
    expect((await documents.listStoreDocuments(admin(), ids.acme)).documents.map(document => document.id)).toEqual([secret.id]);
    /* A store cannot mark its own upload that way. */
    const open = await documents.uploadStoreDocument(owner(), ids.acme, file({ netletOnly: true }));
    expect(open.netletOnly).toBe(false);
    expect((await documents.listStoreDocuments(owner(), ids.acme)).documents.map(document => document.id)).toEqual([open.id]);
  });

  it("let a store remove its own and never NetLet's; NetLet removes any", async () => {
    const contract = await documents.uploadStoreDocument(admin(), ids.acme, file({ kind: "contract", fileName: "Contract.pdf" }));
    const licence = await documents.uploadStoreDocument(owner(), ids.acme, file());
    const [seen] = (await documents.listStoreDocuments(owner(), ids.acme)).documents.filter(document => document.id === contract.id);
    /* The store is told NetLet added it, not which of NetLet's people. */
    expect(seen).toMatchObject({ by: "netlet", uploader: null, mayRemove: false });
    await expect(documents.removeStoreDocument(owner(), contract.id)).rejects.toMatchObject({ reason: "storeDocs.notYours" });
    expect(await documents.removeStoreDocument(owner(), licence.id)).toEqual({ vendorId: ids.acme });
    expect(await documents.removeStoreDocument(admin(), contract.id)).toEqual({ vendorId: ids.acme });
    expect((await documents.listStoreDocuments(admin(), ids.acme)).documents).toEqual([]);
    /* Pressed twice: the second finds nothing. */
    await expect(documents.removeStoreDocument(admin(), contract.id)).rejects.toMatchObject({ reason: "documents.notFound" });
    const removed = await db.select().from(auditLog).where(eq(auditLog.action, "vendor.document.remove"));
    expect(removed.map(row => row.actorRole).sort()).toEqual(["admin", "owner"]);
    expect(removed[0].before).toMatchObject({ kind: expect.any(String), fileName: expect.any(String) });
  });

  it("read a file whose uploader's account is gone as nobody's, for NetLet alone to remove", async () => {
    const saved = await documents.uploadStoreDocument(owner(), ids.acme, file());
    await db.update(vendorDocuments).set({ uploadedBy: null }).where(eq(vendorDocuments.id, saved.id));
    expect((await documents.listStoreDocuments(owner(), ids.acme)).documents[0]).toMatchObject({ by: null, uploader: null, mayRemove: false });
    expect((await documents.listStoreDocuments(admin(), ids.acme)).documents[0]).toMatchObject({ by: null, mayRemove: true });
  });

  it("refuse what is not a document, a kind or a day, without spending the hour", async () => {
    await expect(documents.uploadStoreDocument(owner(), ids.acme, file({ kind: "signed_contract" }))).rejects.toMatchObject({ reason: "storeDocs.chooseKind" });
    await expect(documents.uploadStoreDocument(owner(), ids.acme, file({ kind: "" }))).rejects.toMatchObject({ reason: "storeDocs.chooseKind" });
    await expect(documents.uploadStoreDocument(owner(), ids.acme, file({ expiresOn: "2026-02-30" }))).rejects.toMatchObject({ reason: "storeDocs.badExpiry" });
    await expect(documents.uploadStoreDocument(owner(), ids.acme, file({ bytes: new Uint8Array() }))).rejects.toMatchObject({ reason: "documents.empty" });
    await expect(documents.uploadStoreDocument(owner(), ids.acme, file({ bytes: new TextEncoder().encode("<html>") }))).rejects.toMatchObject({ reason: "documents.notAccepted" });
    /* A PNG that says it is a PDF. */
    await expect(documents.uploadStoreDocument(owner(), ids.acme, file({ bytes: png() }))).rejects.toMatchObject({ reason: "documents.wrongType" });
    await expect(documents.uploadStoreDocument(owner(), ids.acme, file({ bytes: new Uint8Array(4_000_001).fill(0x25) }))).rejects.toMatchObject({ reason: "documents.tooLarge" });
    expect(await db.select().from(authAttempts)).toEqual([]);
    expect(await db.select({ id: vendorDocuments.id }).from(vendorDocuments)).toEqual([]);
    /* A photo is taken for what its bytes say. */
    expect(await documents.uploadStoreDocument(owner(), ids.acme, file({ bytes: png(), declaredType: "image/png", fileName: "scan.jpeg" }))).toMatchObject({ contentType: "image/png", fileName: "scan.png" });
  });

  it("hold a store to its room and an account to its hour", async () => {
    await db.insert(authAttempts).values(Array.from({ length: MAX_STORE_DOCUMENT_UPLOADS_PER_HOUR }, () => ({ bucket: `user:${ids.owner}`, kind: "storeDocument" })));
    await expect(documents.uploadStoreDocument(owner(), ids.acme, file())).rejects.toMatchObject({ reason: "documents.tooMany" });
    /* Another account's hour is its own. */
    await documents.uploadStoreDocument(admin(), ids.acme, file());
    await db.delete(authAttempts);
    await db.insert(vendorDocuments).values(Array.from({ length: MAX_STORE_DOCUMENTS - 1 }, (_, index) => ({
      vendorId: ids.acme, kind: "other" as const, fileName: `f${index}.pdf`, contentType: "application/pdf" as const, byteSize: 9, sha256: "0".repeat(64), bytes: pdf(), uploadedBy: ids.owner,
    })));
    expect((await documents.listStoreDocuments(owner(), ids.acme)).room).toBe(0);
    await expect(documents.uploadStoreDocument(owner(), ids.acme, file())).rejects.toMatchObject({ reason: "storeDocs.tooManyFiles" });
    /* Refused for room, so the hour is not spent either. */
    expect(await db.select().from(authAttempts)).toEqual([]);
    /* The other store has its own room. */
    await documents.uploadStoreDocument(rival(), ids.other, file());
  });

  it("say where each paper stands on the day it is read", async () => {
    const day = (expiresOn: string | null) => documents.uploadStoreDocument(admin(), ids.acme, file({ expiresOn }), new Date("2026-11-11T09:00:00Z"));
    await day("2026-11-10");
    await day("2026-11-11");
    await day("2027-06-30");
    await day(null);
    /* 22:30 UTC on the 10th is already the 11th in Kuwait. */
    const list = await documents.listStoreDocuments(admin(), ids.acme, new Date("2026-11-10T22:30:00Z"));
    expect(list.documents.map(document => document.expiry.kind).sort()).toEqual(["expired", "none", "soon", "valid"]);
  });

  it("go with the store", async () => {
    const gone = (await db.insert(vendors).values({ slug: "closing", name: "Closing", status: "approved" }).returning())[0].id;
    await documents.uploadStoreDocument(admin(), gone, file());
    await db.delete(vendors).where(eq(vendors.id, gone));
    expect(await db.select({ id: vendorDocuments.id }).from(vendorDocuments).where(eq(vendorDocuments.vendorId, gone))).toEqual([]);
  });

  it("are closed, not broken, before the table exists", async () => {
    await client.exec('ALTER TABLE "vendor_documents" RENAME TO "vendor_documents_away"');
    try {
      expect(await documents.listStoreDocuments(owner(), ids.acme)).toEqual({ ready: false, netlet: false, room: 0, documents: [] });
      expect(await documents.listStoreDocuments(admin(), ids.acme)).toMatchObject({ ready: false, netlet: true });
      await expect(documents.uploadStoreDocument(owner(), ids.acme, file())).rejects.toMatchObject({ reason: "storeDocs.unavailable" });
      expect(await documents.readStoreDocument(admin(), 1)).toBeNull();
      expect(await documents.storeOfDocument(1)).toBeNull();
      await expect(documents.removeStoreDocument(admin(), 1)).rejects.toMatchObject({ reason: "documents.notFound" });
      /* Still a permission question first. */
      await expect(documents.listStoreDocuments(manager(), ids.acme)).rejects.toThrow("FORBIDDEN:vendor.editProfile");
    } finally {
      await client.exec('ALTER TABLE "vendor_documents_away" RENAME TO "vendor_documents"');
    }
    expect((await documents.listStoreDocuments(owner(), ids.acme)).ready).toBe(true);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "vendor.document.add"), eq(auditLog.vendorId, ids.acme)))).toEqual([]);
  });
});
