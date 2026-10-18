/**
 * The help page's lookup and assistant, against a real Postgres.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { orderItems, orders, vendors } from "../drizzle/schema.js";
import { helpBrief, HELP_GROUPS } from "../Shared/commerce/helpArticles.js";
import { RETURN_WINDOW_DAYS } from "../Shared/commerce/returns.js";
import { translate } from "../Shared/i18n/dictionary.js";

let db: ReturnType<typeof drizzle>;
let help: typeof import("./help");

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", () => ({ getDb: async () => db }));
  help = await import("./help");

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [order] = await db.insert(orders).values({
    reference: "NL-20261012-QRTVW", email: "Noura@Example.test", status: "paid",
    itemsTotal: "10.000", deliveryTotal: "0.000", grandTotal: "10.000", commissionTotal: "1.000",
    addressLine: "Block 4, Street 12", contactPhone: "99887766",
  }).returning();
  await db.insert(orderItems).values({
    orderId: order.id, vendorId: acme.id, vendorName: "Acme", productTitle: "Desk lamp", variantTitle: "Small",
    unitPrice: "10.000", quantity: 1, lineTotal: "10.000", commissionAmount: "1.000", vendorNet: "9.000", fulfilment: "shipped",
  });
}, 60_000);

describe("finding an order on the help page", () => {
  it("answers the number and email together, however they were typed", async () => {
    const found = await help.lookupOrder(" nl-20261012-qrtvw ", "noura@example.test");
    expect(found).toMatchObject({ reference: "NL-20261012-QRTVW", status: "paid" });
    expect(found?.lines).toEqual([{ title: "Desk lamp", variantTitle: "Small", quantity: 1, fulfilment: "shipped", deliveredAt: null }]);
  });

  it("says nothing more than the state: no address, no phone, no seller's terms", async () => {
    const found = await help.lookupOrder("NL-20261012-QRTVW", "noura@example.test");
    expect(Object.keys(found ?? {}).sort()).toEqual(["lines", "placedAt", "reference", "status"]);
    expect(JSON.stringify(found)).not.toMatch(/99887766|Block 4|vendorNet|commission/);
  });

  it("is not found when either half is wrong", async () => {
    expect(await help.lookupOrder("NL-20261012-QRTVW", "someone@else.test")).toBeNull();
    expect(await help.lookupOrder("NL-20261012-QRTVX", "noura@example.test")).toBeNull();
  });
});

/* The shop assistant answers from these; the gateway refuses a question
   carrying contact details (workers/ai-gateway/src/index.test.ts). */
describe("the help answers the assistant is given", () => {
  it("is given the page's answers and nothing else, in the asker's language", () => {
    const brief = helpBrief((key, params) => translate("en", key, params));
    expect(brief).toContain(`Within ${RETURN_WINDOW_DAYS} days of delivery`);
    expect(brief.split("\nQ: ").length + 0).toBe(HELP_GROUPS.flatMap(group => group.entries).length);
    expect(helpBrief((key, params) => translate("ar", key, params))).toContain("كيف أدفع؟");
  });
});
