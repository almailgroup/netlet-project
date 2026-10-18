/**
 * Inputs the database cannot hold are refused at the door.
 *
 * Every case here came out of one fuzz of all 158 procedures — valid and hostile
 * inputs, as every kind of caller — which made 7,542 calls and got 81 server
 * errors back. None of them was on a valid input; each was a value that passed
 * every zod check this API has and then failed inside Postgres: a 500, and a raw
 * driver sentence where a message key belongs, for something anybody can send by
 * hand. The answer to all of them is the same: refuse it before the database is
 * asked, as `BAD_REQUEST`, so the caller learns what was wrong with *their* input.
 *
 * No database is configured here, which is the point of the shape of these
 * tests: without the guard each call reaches a data layer that answers with an
 * empty result, so the only way to get `BAD_REQUEST` back is to have been refused
 * first.
 */
import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./context.js";
import type { User } from "../../database/schema.js";
import { carriesNul } from "./trpc.js";

const shopper = {
  id: 7, email: "shopper@example.com", passwordHash: null, supabaseUid: "s", name: null, role: "user",
  createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
} as unknown as User;

async function caller(user: User | null = null) {
  const { appRouter } = await import("../routes/index.js");
  const ctx = {
    user,
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {}, cookie: () => {} },
  } as unknown as TrpcContext;
  return appRouter.createCaller(ctx);
}

const refused = { code: "BAD_REQUEST" };

describe("carriesNul", () => {
  it("finds one in a value, a nested value, an array and a key", () => {
    expect(carriesNul("a\u0000b")).toBe(true);
    expect(carriesNul({ lines: [{ note: "ok" }, { note: "x\u0000" }] })).toBe(true);
    expect(carriesNul(["fine", ["\u0000"]])).toBe(true);
    expect(carriesNul({ ["k\u0000"]: 1 })).toBe(true);
  });

  it("passes ordinary text in either language, and things that are not text", () => {
    expect(carriesNul({ title: "Brass lamp", titleAr: "مصباح نحاسي", price: "24.000", stock: 3, on: true, at: null })).toBe(false);
    expect(carriesNul(undefined)).toBe(false);
  });

  /* Bounded, so a hostile nesting cannot make the walk itself the problem. */
  it("stops walking a nesting deeper than any real input", () => {
    let deep: unknown = "\u0000";
    for (let i = 0; i < 200; i++) deep = { inner: deep };
    expect(carriesNul(deep)).toBe(false);
  });
});

describe("a NUL character never reaches a procedure", () => {
  /* Postgres text cannot hold one; twenty-nine procedures failed on it. */
  it("is refused in a public query, with a key the page can translate", async () => {
    await expect((await caller()).commerce.products.byHandle({ handle: "lamp\u0000" }))
      .rejects.toMatchObject({ ...refused, message: "error.invalidText" });
  });

  it("is refused deep inside a mutation's input", async () => {
    await expect((await caller(shopper)).customer.saved.set({ productId: "1\u0000", saved: true }))
      .rejects.toMatchObject({ ...refused, message: "error.invalidText" });
  });
});

describe("a number Postgres cannot hold is refused, not passed on", () => {
  /* A string id turned into a number became NaN, Infinity or 1e+40 on its way
     to an `integer` column. */
  it.each(["NaN", "Infinity", "1e999", "9".repeat(40), "' OR 1=1 --"])("refuses %s as a variant id", async bad => {
    await expect((await caller()).commerce.bundlesForVariant({ variantId: bad })).rejects.toMatchObject(refused);
  });

  /* The storefront's product id is a string that need not be numeric, so a
     non-id is "no reviews" by design — it just must never reach Postgres. */
  it("answers an out-of-range product id with no reviews rather than reaching the database", async () => {
    await expect((await caller()).reviews.forProduct({ productId: "9".repeat(40) }))
      .resolves.toEqual({ items: [], summary: null, total: 0 });
  });

  it.each([2 ** 31, -(2 ** 31) - 1])("refuses variant %d on the storefront", async bad => {
    await expect((await caller()).offers.openOn({ variantIds: [bad] })).rejects.toMatchObject(refused);
  });

  /* A second, public door onto the catalogue's raw rows used to exist beside
     `commerce.*` and skipped every rule the shop's read applies. */
  it("has no public door onto the catalogue's raw rows", async () => {
    const { appRouter } = await import("../routes/index.js");
    const paths = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    expect(paths.filter(path => path.startsWith("inventory.storefront."))).toEqual([]);
  });
});

describe("a string longer than its column is refused", () => {
  it("refuses a saved product id longer than varchar(191)", async () => {
    await expect((await caller(shopper)).customer.saved.set({ productId: "x".repeat(192), saved: true }))
      .rejects.toMatchObject(refused);
  });

  it("refuses a cart id longer than a cart id can be", async () => {
    await expect((await caller(shopper)).customer.profile.update({ cartId: "x".repeat(65) }))
      .rejects.toMatchObject(refused);
  });
});

describe("what a refused input says", () => {
  /* Through the HTTP handler, because that is where the shape is made: a
     server-side caller throws the raw error and never meets the formatter. */
  async function over(path: string, input: unknown) {
    const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
    const { appRouter } = await import("../routes/index.js");
    const url = `http://shop.test/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request(url),
      router: appRouter,
      createContext: () => ({ user: null, req: { protocol: "https", headers: {} }, res: { clearCookie: () => {}, cookie: () => {} } }) as unknown as TrpcContext,
    });
    const body = await response.json() as { error: { json: { message: string } } };
    return body.error.json.message;
  }

  it("is a sentence, never zod's list of issues", async () => {
    expect(await over("commerce.bundlesForVariant", { variantId: "oops" })).toBe("error.invalidInput");
  });

  it("is the schema's own key where one was written", async () => {
    const { inputRefusal } = await import("./trpc.js");
    const { z } = await import("zod");
    const schema = z.object({ link: z.string().regex(/^https?:\/\//, "sell.badLink"), other: z.number() });
    const result = schema.safeParse({ link: "javascript:alert(1)", other: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(inputRefusal(result.error)).toBe("sell.badLink");
  });
});
