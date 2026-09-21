/**
 * The shopper-facing orders router, against a real Postgres.
 *
 * The arithmetic is proved in `shared/commerce/order.test.ts` and the return
 * window in `shared/commerce/returns.test.ts`. What only a database can prove
 * is the part that matters most here: that one shopper cannot read another's
 * orders. An order id is a serial and a reference is short enough to try, so
 * "show me order 4" has to be refused by the query rather than by the page.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { orderItems, orders, users, vendors, type User } from "../../drizzle/schema.js";
import type { TrpcContext } from "../_core/context.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
const people: Record<"mona" | "yusuf", User> = {} as never;

const contextFor = (user: User | null): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});
const asShopper = (who: keyof typeof people) => appRouter.createCaller(contextFor(people[who]));

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("../db", async importOriginal => ({
    ...(await importOriginal<typeof import("../db.js")>()),
    getDb: async () => db,
  }));
  appRouter = (await import("../routers.js")).appRouter;

  const [mona] = await db.insert(users).values({ email: "mona@example.test" }).returning();
  const [yusuf] = await db.insert(users).values({ email: "yusuf@example.test" }).returning();
  people.mona = mona;
  people.yusuf = yusuf;

  const [vendor] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();

  /*
   * Three of Mona's orders, all placed in the same millisecond on purpose.
   * `placedAt` is not unique, and offset paging over a sort that ties repeats
   * rows on the next page and skips others — the bug the admin lists were
   * found to have in a browser because the fixtures there were too small to
   * tie. These fixtures tie deliberately.
   */
  const sameInstant = new Date("2026-09-01T10:00:00Z");
  const monaOrders = await db.insert(orders).values([
    { reference: "NL-20260901-AAAAA", userId: mona.id, email: mona.email, status: "paid", itemsTotal: "10.000", grandTotal: "10.000", placedAt: sameInstant },
    { reference: "NL-20260901-BBBBB", userId: mona.id, email: mona.email, status: "paid", itemsTotal: "20.000", grandTotal: "20.000", placedAt: sameInstant },
    { reference: "NL-20260901-CCCCC", userId: mona.id, email: mona.email, status: "pending_payment", itemsTotal: "30.000", grandTotal: "30.000", placedAt: sameInstant },
  ]).returning();

  await db.insert(orders).values({
    reference: "NL-20260901-ZZZZZ", userId: yusuf.id, email: yusuf.email,
    status: "paid", itemsTotal: "99.000", grandTotal: "99.000",
  });

  // One paid order with four lines, one in each state a return cares about.
  /*
   * `deliveredAt` rather than `updatedAt`. The window used to be measured from
   * whenever the row was last touched, because `order_items` had no delivery
   * date; now it has one, and this fixture says what it means instead of
   * encoding the stand-in.
   */
  const line = (title: string, fulfilment: "delivered" | "shipped" | "returned", deliveredAt: Date) => ({
    orderId: monaOrders[0].id, vendorId: vendor.id, vendorName: "Acme",
    productTitle: title, unitPrice: "2.500", quantity: 1, lineTotal: "2.500",
    fulfilment,
    // A shipped line has not arrived, so it carries no arrival date.
    deliveredAt: fulfilment === "shipped" ? null : deliveredAt,
  });
  await db.insert(orderItems).values([
    line("Recently delivered", "delivered", ago(2)),   // inside the window
    line("Delivered long ago", "delivered", ago(40)),  // long past it
    line("Still shipping", "shipped", ago(1)),         // not arrived
    line("Sent back already", "returned", ago(5)),     // already gone back
  ]);

  // The unpaid order gets a delivered line, which must still refuse.
  await db.insert(orderItems).values({
    orderId: monaOrders[2].id, vendorId: vendor.id, vendorName: "Acme",
    productTitle: "Delivered but unpaid", unitPrice: "5.000", quantity: 1, lineTotal: "5.000",
    fulfilment: "delivered", deliveredAt: ago(1),
  });
});

describe("a shopper's own orders", () => {
  it("lists only their own, never anybody else's", async () => {
    const mine = await asShopper("mona").orders.list({});
    expect(mine.total).toBe(3);
    expect(mine.rows.map((r: { reference: string }) => r.reference).sort())
      .toEqual(["NL-20260901-AAAAA", "NL-20260901-BBBBB", "NL-20260901-CCCCC"]);

    const theirs = await asShopper("yusuf").orders.list({});
    expect(theirs.total).toBe(1);
    expect(theirs.rows[0].reference).toBe("NL-20260901-ZZZZZ");
  });

  it("refuses somebody else's order by reference rather than returning it", async () => {
    // Yusuf's reference is right there in his own list, so this is exactly the
    // attack: paste a known-good reference as a different signed-in user.
    expect(await asShopper("mona").orders.get({ reference: "NL-20260901-ZZZZZ" })).toBeNull();
    expect(await asShopper("yusuf").orders.get({ reference: "NL-20260901-AAAAA" })).toBeNull();
  });

  it("refuses a signed-out caller outright", async () => {
    // On the code, not the sentence: the message is the storefront's own
    // wording and a test that pins it breaks when somebody rephrases a string.
    await expect(appRouter.createCaller(contextFor(null)).orders.list({}))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(appRouter.createCaller(contextFor(null)).orders.get({ reference: "NL-20260901-AAAAA" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("pages without repeating a row, even when every order ties on placedAt", async () => {
    const first = await asShopper("mona").orders.list({ page: 1, pageSize: 2 });
    const second = await asShopper("mona").orders.list({ page: 2, pageSize: 2 });

    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(1);
    const seen = [...first.rows, ...second.rows].map((r: { id: number }) => r.id);
    expect(new Set(seen).size).toBe(3);
  });
});

describe("return state, resolved server-side", () => {
  it("answers per line, and opens only the one still inside its window", async () => {
    const detail = await asShopper("mona").orders.get({ reference: "NL-20260901-AAAAA" });
    expect(detail).not.toBeNull();

    const byTitle = Object.fromEntries(
      detail.lines.map((l: { productTitle: string; returnState: unknown }) => [l.productTitle, l.returnState]),
    );

    expect(byTitle["Recently delivered"]).toMatchObject({ returnable: true });
    expect(byTitle["Still shipping"]).toEqual({ returnable: false, reason: "returns.blockedNotDelivered" });
    expect(byTitle["Sent back already"]).toEqual({ returnable: false, reason: "returns.blockedAlreadyReturned" });
  });

  it("closes the window on a line delivered long ago", async () => {
    const detail = await asShopper("mona").orders.get({ reference: "NL-20260901-AAAAA" });
    const byTitle = Object.fromEntries(
      detail.lines.map((l: { productTitle: string; returnState: unknown }) => [l.productTitle, l.returnState]),
    );
    // Two delivered lines on one order, differing only in when: the point is
    // that the window is per line rather than per order.
    expect(byTitle["Delivered long ago"]).toEqual({ returnable: false, reason: "returns.blockedWindowClosed" });
    expect(byTitle["Recently delivered"]).toMatchObject({ returnable: true });
  });

  it("refuses a delivered line on an order nobody paid for", async () => {
    const detail = await asShopper("mona").orders.get({ reference: "NL-20260901-CCCCC" });
    expect(detail.lines[0].returnState).toEqual({ returnable: false, reason: "returns.blockedUnpaid" });
  });

  it("sends the policy window along, so the page never hard-codes it", async () => {
    const detail = await asShopper("mona").orders.get({ reference: "NL-20260901-AAAAA" });
    expect(detail.windowDays).toBeGreaterThan(0);
  });
});
