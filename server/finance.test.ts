/**
 * The finance report, against a real Postgres.
 *
 * The arithmetic is proved pure in `shared/commerce/finance.test.ts`. What
 * these cover is the half that cannot be: that the query counts the orders
 * whose money actually moved and no others, that the figures come off the
 * *frozen* line rather than today's rates, and that a vendor cannot read the
 * platform's own cut.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { orderItems, orders, users, vendors } from "../drizzle/schema.js";
import type { Actor } from "../shared/inventory/permissions.js";
import { addMoney } from "../shared/money.js";

let db: ReturnType<typeof drizzle>;
let finance: typeof import("./finance.js");
let payouts: typeof import("./payouts.js");

const ids = { admin: 0, vendorOwner: 0, acme: 0, other: 0 };

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
  finance = await import("./finance.js");
  payouts = await import("./payouts.js");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [owner] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [other] = await db.insert(vendors).values({ slug: "other", name: "Other", status: "approved" }).returning();
  ids.admin = admin.id; ids.vendorOwner = owner.id; ids.acme = acme.id; ids.other = other.id;
}, 60_000);

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(orders);
});

const adminActor = (): Actor => ({ kind: "admin", userId: ids.admin });
const vendorActor = (): Actor => ({ kind: "vendor", userId: ids.vendorOwner, vendorId: ids.acme, role: "owner" });

let reference = 0;
async function order(status: "paid" | "refunded" | "pending_payment" | "cancelled", lines: {
  vendorId: number; vendorName: string; lineTotal: string; commissionAmount: string; vendorNet: string;
}[], placedAt = new Date("2026-09-15T10:00:00Z")) {
  reference += 1;
  const [row] = await db.insert(orders).values({
    reference: `NL-TEST-${reference}`, email: "s@example.test", status, placedAt,
    itemsTotal: "0.000", deliveryTotal: "0.000", grandTotal: "0.000", commissionTotal: "0.000",
  }).returning();
  for (const line of lines) {
    await db.insert(orderItems).values({
      orderId: row.id, vendorId: line.vendorId, vendorName: line.vendorName,
      productTitle: "Thing", unitPrice: line.lineTotal, quantity: 1,
      lineTotal: line.lineTotal, commissionAmount: line.commissionAmount, vendorNet: line.vendorNet,
    });
  }
  return row;
}

const acmeLine = (total: string, commission: string, net: string) =>
  ({ vendorId: ids.acme, vendorName: "Acme", lineTotal: total, commissionAmount: commission, vendorNet: net });

describe("who may read it", () => {
  /*
   * Commission and the platform's own cut sit outside a vendor's control
   * entirely, and so does the report of them. A vendor seeing their own
   * payouts is a different feature with a different scope.
   */
  it("refuses a vendor owner, who is not an administrator of NetLet", async () => {
    await expect(finance.financeReport(vendorActor())).rejects.toThrow(/FORBIDDEN/);
  });

  it("allows an admin", async () => {
    await expect(finance.financeReport(adminActor())).resolves.toBeTruthy();
  });
});

describe("what the report counts", () => {
  it("adds up paid orders", async () => {
    await order("paid", [acmeLine("100.000", "10.000", "90.000")]);
    await order("paid", [acmeLine("50.000", "5.000", "45.000")]);

    const report = await finance.financeReport(adminActor());
    expect(report.totals.gross).toBe("150.000");
    expect(report.totals.commission).toBe("15.000");
    expect(report.totals.vendorNet).toBe("135.000");
  });

  /* A basket abandoned at the card form is not revenue. */
  it("ignores an order that never completed", async () => {
    await order("pending_payment", [acmeLine("100.000", "10.000", "90.000")]);
    await order("cancelled", [acmeLine("80.000", "8.000", "72.000")]);

    const report = await finance.financeReport(adminActor());
    expect(report.totals.gross).toBe("0.000");
    expect(report.totals.paidLines).toBe(0);
  });

  it("shows a refund separately and reverses its commission", async () => {
    await order("paid", [acmeLine("100.000", "10.000", "90.000")]);
    await order("refunded", [acmeLine("40.000", "4.000", "36.000")]);

    const report = await finance.financeReport(adminActor());
    // 140 was charged across the two, 40 went back, 100 stuck.
    expect(report.totals.gross).toBe("140.000");
    expect(report.totals.refunded).toBe("40.000");
    expect(report.totals.net).toBe("100.000");
    // The money went back, so NetLet did not keep its cut on it.
    expect(report.totals.commission).toBe("10.000");
    // And the table reconciles: 10 + 90 = 100.
    expect(addMoney(report.totals.commission, report.totals.vendorNet)).toBe(report.totals.net);
  });

  it("splits by seller and by month", async () => {
    await order("paid", [
      acmeLine("100.000", "10.000", "90.000"),
      { vendorId: ids.other, vendorName: "Other", lineTotal: "300.000", commissionAmount: "30.000", vendorNet: "270.000" },
    ], new Date("2026-08-04T10:00:00Z"));
    await order("paid", [acmeLine("20.000", "2.000", "18.000")], new Date("2026-09-04T10:00:00Z"));

    const report = await finance.financeReport(adminActor());
    expect(report.vendors.map(v => v.vendorName)).toEqual(["Other", "Acme"]);
    expect(report.vendors[1].gross).toBe("120.000");
    expect(report.months.map(m => m.month)).toEqual(["2026-08", "2026-09"]);
  });

  /*
   * The figures come off the line, which froze them. Changing a vendor's rate
   * today must not rewrite what they were owed in August — the whole reason
   * `order_items` copies the rate beside the price.
   */
  it("does not move when the vendor's commission rate changes afterwards", async () => {
    await order("paid", [acmeLine("100.000", "10.000", "90.000")]);
    const before = await finance.financeReport(adminActor());

    await db.update(vendors).set({ commissionPercent: "40.00" }).where(eq(vendors.id, ids.acme));

    const after = await finance.financeReport(adminActor());
    expect(after.totals.commission).toBe(before.totals.commission);
    expect(after.totals.commission).toBe("10.000");
  });

  it("keeps a removed vendor's frozen name in the report", async () => {
    await order("paid", [{ vendorId: ids.other, vendorName: "Other", lineTotal: "10.000", commissionAmount: "1.000", vendorNet: "9.000" }]);
    await db.update(orderItems).set({ vendorId: null }).where(eq(orderItems.vendorName, "Other"));

    const report = await finance.financeReport(adminActor());
    expect(report.vendors[0].vendorName).toBe("Other");
  });

  it("narrows to a date range", async () => {
    await order("paid", [acmeLine("100.000", "10.000", "90.000")], new Date("2026-07-10T10:00:00Z"));
    await order("paid", [acmeLine("25.000", "2.500", "22.500")], new Date("2026-09-10T10:00:00Z"));

    const report = await finance.financeReport(adminActor(), { from: new Date("2026-09-01T00:00:00Z") });
    expect(report.totals.gross).toBe("25.000");
  });

  it("reports nothing rather than failing on an empty shop", async () => {
    const report = await finance.financeReport(adminActor());
    expect(report.totals.paidLines).toBe(0);
    expect(report.vendors).toEqual([]);
    expect(report.months).toEqual([]);
    expect(report.truncated).toBe(false);
  });
});

/* Requirement 3.3.16: what each seller is owed, by week. */
describe("the weekly payout report", () => {
  it("groups a seller's frozen net into Sunday weeks", async () => {
    await order("paid", [acmeLine("100.000", "10.000", "90.000")], new Date("2026-09-23T10:00:00Z"));
    await order("paid", [acmeLine("50.000", "5.000", "45.000")], new Date("2026-09-24T10:00:00Z"));
    await order("paid", [acmeLine("20.000", "2.000", "18.000")], new Date("2026-10-01T10:00:00Z"));

    const report = await payouts.payoutReport(adminActor());
    const acme = report.vendors.find(v => v.vendorName === "Acme")!;
    expect(acme.weeks.map(w => w.weekStart)).toEqual(["2026-09-20", "2026-09-27"]);
    expect(acme.weeks[0].owed).toBe("135.000");
    expect(acme.owed).toBe("153.000");
    expect(report.owed).toBe("153.000");
  });

  /* Subtracted from the week of the sale, not the week it came back. */
  it("takes a refund off the week it was sold in", async () => {
    await order("paid", [acmeLine("100.000", "10.000", "90.000")], new Date("2026-09-23T10:00:00Z"));
    await order("refunded", [acmeLine("100.000", "10.000", "90.000")], new Date("2026-09-24T10:00:00Z"));

    const report = await payouts.payoutReport(adminActor());
    expect(report.vendors[0].weeks[0].owed).toBe("0.000");
    expect(report.owed).toBe("0.000");
  });

  /*
   * A vendor sees their own weeks and nobody else's — the whole payout run
   * would be their competitors' revenue.
   */
  it("shows a vendor only their own store", async () => {
    await order("paid", [acmeLine("100.000", "10.000", "90.000")]);
    await order("paid", [{ vendorId: ids.other, vendorName: "Other", lineTotal: "300.000", commissionAmount: "30.000", vendorNet: "270.000" }]);

    const mine = await payouts.payoutReport(vendorActor());
    expect(mine.vendors.map(v => v.vendorName)).toEqual(["Acme"]);
    expect(mine.owed).toBe("90.000");

    const all = await payouts.payoutReport(adminActor());
    expect(all.vendors.length).toBe(2);
  });

  /* It names companies, and one seller learning another has no licence of
     their own is not a fact NetLet should hand out. */
  it("refuses a vendor the list of sellers under NetLet's licence", async () => {
    await expect(payouts.sellersUnderPlatformLicence(vendorActor())).rejects.toThrow("FORBIDDEN:platform.viewAll");
    await expect(payouts.sellersUnderPlatformLicence(adminActor())).resolves.toEqual([]);
  });
});

/* Requirement 3.3.21: when the money is actually due. */
describe("when a payout is due", () => {
  it("has no due date while the cash has not arrived", async () => {
    const row = await order("paid", [acmeLine("100.000", "10.000", "90.000")]);
    await db.update(orders).set({ status: "pending_payment", paymentMethod: "cod" }).where(eq(orders.id, row.id));

    const [entry] = await payouts.payoutDueList(adminActor());
    expect(entry.due.state).toBe("unpaid");
  });

  /*
   * The clock starts when the money arrived, not when the order was placed:
   * counting from the press would promise a payout for money NetLet does not
   * hold.
   */
  it("counts from the collection rather than the order date", async () => {
    const row = await order("paid", [acmeLine("100.000", "10.000", "90.000")], new Date("2026-08-03T10:00:00Z"));
    await db.update(orders).set({
      paymentMethod: "cod",
      paymentCollectedAt: new Date("2026-09-21T10:00:00Z"),
    }).where(eq(orders.id, row.id));

    const [entry] = await payouts.payoutDueList(adminActor());
    expect(entry.due.state === "due" || entry.due.state === "held").toBe(true);
    if (entry.due.state === "due" || entry.due.state === "held") {
      /* 21 September 2026 is a Monday; 14 business days across three
         Friday-Saturday weekends lands on Sunday 11 October. */
      expect(entry.due.window.from.toISOString().slice(0, 10)).toBe("2026-10-11");
    }
  });

  /* Money that went back is not a payout waiting to happen. */
  it("reports a refunded order as refunded rather than due", async () => {
    await order("refunded", [acmeLine("40.000", "4.000", "36.000")]);
    const [entry] = await payouts.payoutDueList(adminActor());
    expect(entry.due.state).toBe("refunded");
    expect(entry.owed).toBe("-36.000");
  });

  it("shows a vendor only their own", async () => {
    await order("paid", [acmeLine("100.000", "10.000", "90.000")]);
    await order("paid", [{ vendorId: ids.other, vendorName: "Other", lineTotal: "50.000", commissionAmount: "5.000", vendorNet: "45.000" }]);
    expect((await payouts.payoutDueList(vendorActor())).map(r => r.vendorName)).toEqual(["Acme"]);
  });
});
