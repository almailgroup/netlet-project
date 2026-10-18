/**
 * Seller self-registration, against a real Postgres.
 *
 * The rules are proved pure in `Shared/inventory/sellerApplication.test.ts`.
 * What is here is everything that cannot be: that one account cannot have two
 * open applications however many tabs try, that approving actually creates a
 * store with its owner attached, that a store nobody can sign into is never
 * left behind, and that the queue refuses somebody who is not an administrator.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applicationDocuments, auditLog, users, vendorApplications, vendorMembers, vendors } from "../../database/schema.js";
import { AGREEMENT_VERSION } from "../../../Shared/inventory/sellerApplication.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let apps: typeof import("./applications.js");
let docs: typeof import("./applicationDocuments.js");

const ids = { admin: 0, applicant: 0, other: 0 };

const complete = {
  storeName: "Harbour Lighting",
  contactEmail: "hello@harbour.test",
  contactPhone: "+965 9123 4567",
  governorate: "hawalli",
  addressLine: "Block 4, Street 12",
  licenceNumber: "TL-99812",
  payoutIban: "KW81CBKU0000000000001234560101",
  underPlatformLicence: false,
  agreementVersion: AGREEMENT_VERSION,
};

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({
    ...(await importOriginal<typeof import("./db.js")>()),
    getDb: async () => db,
  }));
  apps = await import("./applications.js");
  docs = await import("./applicationDocuments.js");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [applicant] = await db.insert(users).values({ email: "seller@harbour.test" }).returning();
  const [other] = await db.insert(users).values({ email: "somebody@else.test" }).returning();
  Object.assign(ids, { admin: admin.id, applicant: applicant.id, other: other.id });
}, 60_000);

beforeEach(async () => {
  await db.delete(vendorMembers);
  await db.delete(vendorApplications);
  await db.delete(vendors);
});

const adminActor = (): Actor => ({ kind: "admin", userId: ids.admin });
const shopperActor = (): Actor => ({ kind: "vendor", userId: ids.other, vendorId: 1, role: "owner" });

describe("filling one in", () => {
  it("saves a draft with almost nothing in it", async () => {
    const row = await apps.saveApplication(ids.applicant, { storeName: "Harbour Lighting" });
    expect(row).toMatchObject({ storeName: "Harbour Lighting", status: "draft" });
  });

  /* Saving is easy and approving is strict: refusing a save because a licence
     is on a document nobody has scanned is how a form goes unfinished. */
  it("refuses only what is actively wrong", async () => {
    await expect(apps.saveApplication(ids.applicant, { storeName: "X", payoutIban: "KW00NOPE" }))
      .rejects.toMatchObject({ reason: "application.badIban" });
    await expect(apps.saveApplication(ids.applicant, { storeName: "X", licenceDocUrl: "http://example.com/a.pdf" }))
      .rejects.toMatchObject({ reason: "application.insecureDocument" });
  });

  /* The index is what enforces this: two tabs beat a read-then-insert, and a
     reviewer reading the same store twice stops reading the queue. */
  it("keeps one open application per account, editing rather than adding", async () => {
    await apps.saveApplication(ids.applicant, { storeName: "First" });
    await apps.saveApplication(ids.applicant, { storeName: "Second" });

    const rows = await db.select().from(vendorApplications).where(eq(vendorApplications.userId, ids.applicant));
    expect(rows).toHaveLength(1);
    expect(rows[0].storeName).toBe("Second");
  });

  it("normalises the IBAN the way the store record stores it", async () => {
    const row = await apps.saveApplication(ids.applicant, {
      storeName: "Harbour", payoutIban: "kw81 cbku 0000 0000 0000 1234 5601 01",
    });
    expect(row.payoutIban).toBe("KW81CBKU0000000000001234560101");
  });
});

describe("handing it in", () => {
  it("refuses an incomplete one, while the applicant is still looking at it", async () => {
    await apps.saveApplication(ids.applicant, { storeName: "Harbour Lighting" });
    await expect(apps.submitApplication(ids.applicant)).rejects.toMatchObject({ reason: "application.incomplete" });
  });

  it("takes a complete one and locks it", async () => {
    await apps.saveApplication(ids.applicant, complete);
    expect((await apps.submitApplication(ids.applicant)).status).toBe("submitted");

    /* An application with a reviewer is not a draft any more. */
    await expect(apps.saveApplication(ids.applicant, complete))
      .rejects.toMatchObject({ reason: "application.locked" });
  });
});

describe("reviewing", () => {
  async function waiting() {
    await apps.saveApplication(ids.applicant, complete);
    await apps.submitApplication(ids.applicant);
    const [row] = await db.select().from(vendorApplications).where(eq(vendorApplications.userId, ids.applicant));
    return row;
  }

  it("shows an administrator what is waiting, and refuses everybody else", async () => {
    await waiting();
    const page = await apps.listApplications(adminActor(), { status: "submitted" });
    expect(page.total).toBe(1);
    expect(page.rows[0].applicantEmail).toBe("seller@harbour.test");

    await expect(apps.listApplications(shopperActor())).rejects.toThrow("FORBIDDEN:platform.manageUsers");
  });

  /* Approving is what creates the store — there is no second step, because a
     vendor left `pending` is one somebody has to clear later. */
  it("opens the store and makes the applicant its owner", async () => {
    const row = await waiting();
    const { vendorId } = await apps.approveApplication(adminActor(), row.id);

    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
    expect(vendor).toMatchObject({
      name: "Harbour Lighting",
      slug: "harbour-lighting",
      status: "approved",
      payoutIban: "KW81CBKU0000000000001234560101",
    });

    const members = await db.select().from(vendorMembers).where(eq(vendorMembers.vendorId, vendorId));
    expect(members).toEqual([expect.objectContaining({ userId: ids.applicant, role: "owner" })]);

    const [after] = await db.select().from(vendorApplications).where(eq(vendorApplications.id, row.id));
    expect(after).toMatchObject({ status: "approved", vendorId, reviewedBy: ids.admin });
  });

  /* A second store of the same name is ordinary, and a collision at approval
     would refuse for a reason the administrator cannot act on. */
  it("gives a second store of the same name a slug of its own", async () => {
    const first = await waiting();
    await apps.approveApplication(adminActor(), first.id);

    await apps.saveApplication(ids.other, { ...complete, contactEmail: "two@harbour.test" });
    await apps.submitApplication(ids.other);
    const [second] = await db.select().from(vendorApplications).where(eq(vendorApplications.userId, ids.other));
    const { vendorId } = await apps.approveApplication(adminActor(), second.id);

    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
    expect(vendor.slug).toBe("harbour-lighting-2");
  });

  it("refuses to approve one that is not waiting", async () => {
    await apps.saveApplication(ids.applicant, complete);
    const [draft] = await db.select().from(vendorApplications).where(eq(vendorApplications.userId, ids.applicant));
    await expect(apps.approveApplication(adminActor(), draft.id))
      .rejects.toMatchObject({ reason: "application.notWaiting" });
  });

  /* A rejection with no reason sends somebody back to guess. */
  it("insists on a reason, and lets the applicant correct and resend", async () => {
    const row = await waiting();
    await expect(apps.rejectApplication(adminActor(), row.id, "   "))
      .rejects.toMatchObject({ reason: "application.noReason" });

    await apps.rejectApplication(adminActor(), row.id, "The licence number does not match the name.");
    const [rejected] = await db.select().from(vendorApplications).where(eq(vendorApplications.id, row.id));
    expect(rejected).toMatchObject({ status: "rejected", rejectionReason: "The licence number does not match the name." });

    /* Correcting it clears the reason: leaving it on the row they have just
       fixed reads as a second refusal. */
    const fixed = await apps.saveApplication(ids.applicant, { ...complete, licenceNumber: "TL-11111" });
    expect(fixed).toMatchObject({ status: "draft", rejectionReason: null });
  });

  it("counts what is waiting, for the overview", async () => {
    expect(await apps.countWaitingApplications(adminActor())).toBe(0);
    await waiting();
    expect(await apps.countWaitingApplications(adminActor())).toBe(1);
  });

  /* 3.3.2: the standard rate is what a store gets unless NetLet decides
     otherwise, and a proposal is read, never applied by itself. */
  it("charges the standard rate when the administrator sets none, whatever was proposed", async () => {
    await apps.saveApplication(ids.applicant, { ...complete, proposedCommissionPercent: "7", commissionNote: "We sell high volumes of small items." });
    await apps.submitApplication(ids.applicant);
    const [row] = await db.select().from(vendorApplications).where(eq(vendorApplications.userId, ids.applicant));
    expect(row).toMatchObject({ proposedCommissionPercent: "7.00", commissionNote: "We sell high volumes of small items." });

    const { vendorId } = await apps.approveApplication(adminActor(), row.id);
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
    expect(vendor.commissionPercent).toBe("10.00");
    expect(await db.select().from(auditLog).where(eq(auditLog.subjectId, vendorId))).toHaveLength(0);
  });

  it("sets the rate the administrator chose at approval, and records it as a commission decision", async () => {
    await apps.saveApplication(ids.applicant, { ...complete, proposedCommissionPercent: "7" });
    await apps.submitApplication(ids.applicant);
    const [row] = await db.select().from(vendorApplications).where(eq(vendorApplications.userId, ids.applicant));

    const { vendorId } = await apps.approveApplication(adminActor(), row.id, "8.5");
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
    expect(vendor.commissionPercent).toBe("8.50");
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.subjectId, vendorId));
    expect(entry).toMatchObject({ action: "vendor.setCommission", actorId: ids.admin });
    expect(entry.after).toMatchObject({ commissionPercent: "8.5", proposedCommissionPercent: "7.00" });
  });

  it("refuses a proposal that is not a rate, or is not below the standard one", async () => {
    await expect(apps.saveApplication(ids.applicant, { ...complete, proposedCommissionPercent: "abc" })).rejects.toThrow("application.badCommission");
    await expect(apps.saveApplication(ids.applicant, { ...complete, proposedCommissionPercent: "10" })).rejects.toThrow("application.commissionNotLower");
    await expect(apps.saveApplication(ids.applicant, { ...complete, proposedCommissionPercent: "150" })).rejects.toThrow("application.badCommission");
  });

  /* A reason with nothing to be a reason for is not kept. */
  it("drops a reason when there is no proposal", async () => {
    const row = await apps.saveApplication(ids.applicant, { ...complete, proposedCommissionPercent: "", commissionNote: "please" });
    expect(row).toMatchObject({ proposedCommissionPercent: null, commissionNote: null });
  });
});

describe("uploaded documents", () => {
  const pdf = (text = "licence") => new Uint8Array([...`%PDF-1.7\n${text}`].map(c => c.charCodeAt(0)));
  const upload = (userId: number, kind: "trade_licence" | "signatory_id" = "trade_licence", text = "licence") =>
    docs.uploadDocument(userId, { kind, fileName: `${kind}.pdf`, declaredType: "application/pdf", bytes: pdf(text) });

  it("needs a saved application, and refuses a file that is not what it says", async () => {
    await expect(upload(ids.applicant)).rejects.toMatchObject({ reason: "documents.saveFirst" });
    await apps.saveApplication(ids.applicant, complete);
    await expect(docs.uploadDocument(ids.applicant, { kind: "trade_licence", fileName: "a.png", declaredType: "image/png", bytes: pdf() }))
      .rejects.toMatchObject({ reason: "documents.wrongType" });
    await expect(docs.uploadDocument(ids.applicant, { kind: "trade_licence", fileName: "a.html", declaredType: "application/pdf", bytes: new Uint8Array([60, 104, 116, 109, 108, 62]) }))
      .rejects.toMatchObject({ reason: "documents.notAccepted" });
  });

  it("is stored with its hash, listed without its bytes, and readable only by its applicant and NetLet", async () => {
    await apps.saveApplication(ids.applicant, complete);
    const saved = await upload(ids.applicant);
    expect(saved).toMatchObject({ kind: "trade_licence", fileName: "trade_licence.pdf", contentType: "application/pdf", status: "pending" });
    expect(saved).not.toHaveProperty("bytes");
    const [row] = await db.select().from(applicationDocuments).where(eq(applicationDocuments.id, saved.id));
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);

    const mine = (await docs.myDocuments(ids.applicant))[0];
    expect(mine).not.toHaveProperty("bytes");
    expect((await docs.readDocument({ kind: "customer", userId: ids.applicant }, saved.id))?.contentType).toBe("application/pdf");
    expect(await docs.readDocument(adminActor(), saved.id)).not.toBeNull();
    /* Anybody else, and a store owner too: the same answer as a number that does not exist. */
    expect(await docs.readDocument(shopperActor(), saved.id)).toBeNull();
    expect(await docs.readDocument(adminActor(), 999_999)).toBeNull();
    expect(await docs.myDocuments(ids.other)).toEqual([]);
    await expect(docs.documentsFor(shopperActor(), 1)).rejects.toThrow("FORBIDDEN");
  });

  it("holds approval until each is decided, and a rejection says why", async () => {
    await apps.saveApplication(ids.applicant, complete);
    const saved = await upload(ids.applicant);
    await apps.submitApplication(ids.applicant);
    const [application] = await db.select().from(vendorApplications).where(eq(vendorApplications.userId, ids.applicant));
    expect((await apps.listApplications(adminActor(), { status: "submitted" })).rows[0].documentsWaiting).toBe(1);
    await expect(apps.approveApplication(adminActor(), application.id)).rejects.toThrow("application.documentsPending");

    /* Submitted: the applicant cannot change what is in front of the reviewer. */
    await expect(upload(ids.applicant, "signatory_id")).rejects.toMatchObject({ reason: "documents.locked" });
    await expect(docs.deleteDocument(ids.applicant, saved.id)).rejects.toMatchObject({ reason: "documents.locked" });

    await expect(docs.reviewDocument(adminActor(), { id: saved.id, decision: "reject", note: "  " })).rejects.toMatchObject({ reason: "documents.needsNote" });
    await expect(docs.reviewDocument(shopperActor(), { id: saved.id, decision: "accept" })).rejects.toThrow("FORBIDDEN");
    expect(await docs.reviewDocument(adminActor(), { id: saved.id, decision: "reject", note: "The scan is cut off." })).toBe("rejected");
    await expect(docs.reviewDocument(adminActor(), { id: saved.id, decision: "accept" })).rejects.toMatchObject({ reason: "documents.notWaiting" });
    expect((await docs.myDocuments(ids.applicant))[0]).toMatchObject({ status: "rejected", reviewNote: "The scan is cut off." });

    const { vendorId } = await apps.approveApplication(adminActor(), application.id);
    expect(vendorId).toBeGreaterThan(0);
  });

  it("keeps an accepted file until its replacement is accepted, then lets the old one go", async () => {
    await apps.saveApplication(ids.applicant, complete);
    const first = await upload(ids.applicant, "trade_licence", "first");
    await docs.reviewDocument(adminActor(), { id: first.id, decision: "accept" });
    const second = await upload(ids.applicant, "trade_licence", "second");

    /* Accepted files are replaced, never removed by the applicant; a waiting one can be taken back. */
    await expect(docs.deleteDocument(ids.applicant, first.id)).rejects.toMatchObject({ reason: "documents.notFound" });
    expect((await docs.myDocuments(ids.applicant)).map(d => d.id)).toEqual([second.id, first.id]);

    await docs.reviewDocument(adminActor(), { id: second.id, decision: "accept" });
    expect((await docs.myDocuments(ids.applicant)).map(d => d.id)).toEqual([second.id]);

    const third = await upload(ids.applicant, "trade_licence", "third");
    await docs.deleteDocument(ids.applicant, third.id);
    await expect(docs.deleteDocument(ids.other, second.id)).rejects.toMatchObject({ reason: "documents.notFound" });
    expect((await docs.myDocuments(ids.applicant)).map(d => d.id)).toEqual([second.id]);
  });

  it("goes with the application", async () => {
    await apps.saveApplication(ids.applicant, complete);
    await upload(ids.applicant);
    await db.delete(vendorApplications);
    expect(await db.select().from(applicationDocuments)).toEqual([]);
  });
});
