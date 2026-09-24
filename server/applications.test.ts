/**
 * Seller self-registration, against a real Postgres.
 *
 * The rules are proved pure in `shared/inventory/sellerApplication.test.ts`.
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
import { users, vendorApplications, vendorMembers, vendors } from "../drizzle/schema.js";
import { AGREEMENT_VERSION } from "../shared/inventory/sellerApplication.js";
import type { Actor } from "../shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let apps: typeof import("./applications.js");

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
  const dir = path.resolve(import.meta.dirname, "../drizzle");
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
});
