/**
 * Wishlists against a real Postgres, and the privacy rules in particular.
 *
 * The pure rules — the phone key, the claim window, what may be shared — are
 * proved in `Shared/commerce/wishlist.test.ts`. What only a database can prove
 * is everything this file is about: that a private list is invisible, that one
 * shopper cannot touch another's, that an owner is not told which of their
 * wishes somebody has claimed, and that two relatives racing for the same
 * present cannot both be told they have it.
 *
 * The lookup throttle gets its own test because a throttle nobody exercises is
 * a constant in a file.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authAttempts, customerPreferences, savedProducts, users, wishlistItems, wishlists, type User } from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";
import { CLAIM_HOLD_DAYS } from "../../../Shared/commerce/wishlist.js";
import { MAX_LOOKUPS_PER_ADDRESS } from "../../../Shared/auth/rateLimit.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
const people: Record<"noura" | "salem" | "aunt", User> = {} as never;

const contextFor = (user: User | null, ip = "10.0.0.1"): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {}, ip } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});
const asShopper = (who: keyof typeof people) => appRouter.createCaller(contextFor(people[who]));
/** A relative with no NetLet account — the caller this feature exists for. */
const asStranger = (ip = "10.0.0.9") => appRouter.createCaller(contextFor(null, ip));

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("../services/db", async importOriginal => ({
    ...(await importOriginal<typeof import("../services/db.js")>()),
    getDb: async () => db,
  }));
  appRouter = (await import("./index.js")).appRouter;

  for (const who of ["noura", "salem", "aunt"] as const) {
    const [row] = await db.insert(users).values({ email: `${who}@example.test` }).returning();
    people[who] = row;
  }
}, 60_000);

beforeEach(async () => {
  await db.delete(authAttempts);
});

describe("owning a list", () => {
  it("starts private, and a private list is invisible to a phone lookup", async () => {
    const noura = asShopper("noura");
    await noura.wishlists.setPhone({ phone: "5012 3456" });
    const id = await noura.wishlists.create({ title: "Birthday" });

    const [list] = await noura.wishlists.mine();
    expect(list.visibility).toBe("private");

    // The owner can see it; nobody else can find it.
    expect(await asStranger().wishlists.findByPhone({ phone: "50123456" })).toEqual([]);
  });

  it("is findable once published, at any spelling of the number", async () => {
    const noura = asShopper("noura");
    const lists = await noura.wishlists.mine();
    await noura.wishlists.update({ listId: lists[0].id, visibility: "public", ownerName: "Noura" });

    for (const spelling of ["+965 5012 3456", "00965 50123456", "٥٠١٢٣٤٥٦"]) {
      const found = await asStranger().wishlists.findByPhone({ phone: spelling });
      expect(found).toHaveLength(1);
      expect(found[0].title).toBe("Birthday");
      expect(found[0].ownerName).toBe("Noura");
    }
  });

  it("is findable by the name it shows, whole or by its first word, and never by a fragment", async () => {
    const noura = asShopper("noura");
    const lists = await noura.wishlists.mine();
    await noura.wishlists.update({ listId: lists[0].id, ownerName: "Noura Al-Sabah" });
    for (const name of ["Noura Al-Sabah", "noura", "  NOURA  al-sabah "]) {
      const found = await asStranger().wishlists.findByName({ name });
      expect(found.map(list => list.title)).toEqual(["Birthday"]);
    }
    expect(await asStranger().wishlists.findByName({ name: "Nou" })).toEqual([]);
    expect(await asStranger().wishlists.findByName({ name: "Sabah" })).toEqual([]);
    // A wildcard typed is a character, never a pattern.
    expect(await asStranger().wishlists.findByName({ name: "%" + "%" })).toEqual([]);
    await noura.wishlists.update({ listId: lists[0].id, ownerName: "Noura" });
  });

  /*
   * The answer for "nobody has that number" and "that person publishes
   * nothing" has to be the same answer, or the lookup becomes a way to ask
   * which phone numbers shop at NetLet.
   */
  it("answers a number with no account exactly as a number with nothing published", async () => {
    const salem = asShopper("salem");
    await salem.wishlists.setPhone({ phone: "66001122" });
    await salem.wishlists.create({ title: "Secret" });   // left private

    const nobody = await asStranger().wishlists.findByPhone({ phone: "99887766" });
    const nothingPublished = await asStranger().wishlists.findByPhone({ phone: "66001122" });
    expect(nobody).toEqual(nothingPublished);
    expect(nobody).toEqual([]);
  });

  it("never leaks an email, an account id or another list", async () => {
    const found = await asStranger().wishlists.findByPhone({ phone: "50123456" });
    const serialised = JSON.stringify(found);
    expect(serialised).not.toContain("noura@example.test");
    expect(serialised).not.toContain("userId");
    expect(serialised).not.toContain("Secret");
    // The share token is what a URL carries; the serial id never leaves.
    expect(found[0]).not.toHaveProperty("id");
  });

  it("refuses to let one shopper touch another's list", async () => {
    const [nouras] = await asShopper("noura").wishlists.mine();
    const salem = asShopper("salem");

    await expect(salem.wishlists.get({ listId: nouras.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(salem.wishlists.update({ listId: nouras.id, title: "Mine now" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(salem.wishlists.remove({ listId: nouras.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(salem.wishlists.addItem({ listId: nouras.id, productId: "9" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a signed-out caller entirely", async () => {
    await expect(asStranger().wishlists.mine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("will not let two accounts claim one phone number", async () => {
    await expect(asShopper("salem").wishlists.setPhone({ phone: "50123456" }))
      .rejects.toMatchObject({ message: "wishlist.phoneTaken" });
  });

  it("refuses a number that is not one", async () => {
    await expect(asShopper("salem").wishlists.setPhone({ phone: "12345" })).rejects.toBeTruthy();
  });
});

describe("putting things on a list", () => {
  /*
   * The plain press, with no note and no quantity. Every other test here sent
   * a note, so the empty-patch path went unexercised and shipped broken — an
   * `onConflictDoUpdate` with nothing to set is refused when the statement is
   * built, so it failed on the *first* add rather than on a repeat.
   */
  it("adds a product with nothing but its id", async () => {
    const noura = asShopper("noura");
    const [list] = await noura.wishlists.mine();
    await expect(noura.wishlists.addItem({ listId: list.id, productId: "777" })).resolves.toBeUndefined();

    const after = await noura.wishlists.get({ listId: list.id });
    expect(after.items.map((i: { productId: string }) => i.productId)).toContain("777");
  });

  /*
   * The count beside each list is a correlated subquery, and Drizzle wrote its
   * outer column bare, so it counted items whose own id matched the list's —
   * every list read "0 items" on the account page however full it was.
   */
  it("counts what is on each list", async () => {
    const noura = asShopper("noura");
    const [list] = await noura.wishlists.mine();
    await noura.wishlists.addItem({ listId: list.id, productId: "778" });
    const { items } = await noura.wishlists.get({ listId: list.id });
    const [counted] = await noura.wishlists.mine();
    expect(items.length).toBeGreaterThan(1);
    expect(counted.itemCount).toBe(items.length);
    await noura.wishlists.removeItem({ listId: list.id, itemId: items.find((i: { productId: string }) => i.productId === "778").id });
  });

  it("is idempotent: pressing add twice does not throw or duplicate", async () => {
    const noura = asShopper("noura");
    const [list] = await noura.wishlists.mine();
    await noura.wishlists.addItem({ listId: list.id, productId: "777" });
    const after = await noura.wishlists.get({ listId: list.id });
    expect(after.items.filter((i: { productId: string }) => i.productId === "777")).toHaveLength(1);
  });

  /* A note must not quietly reset a quantity somebody set. */
  it("updates only the field it was given", async () => {
    const noura = asShopper("noura");
    const [list] = await noura.wishlists.mine();
    await noura.wishlists.addItem({ listId: list.id, productId: "888", quantity: 3 });
    await noura.wishlists.addItem({ listId: list.id, productId: "888", note: "the tall one" });

    const after = await noura.wishlists.get({ listId: list.id });
    const item = after.items.find((i: { productId: string }) => i.productId === "888");
    expect(item.note).toBe("the tall one");
    expect(item.quantity).toBe(3);

    await noura.wishlists.removeItem({ listId: list.id, itemId: item.id });
  });
});

describe("what the owner is not told", () => {
  /*
   * The whole point of a gift list: its owner must not be able to watch items
   * go grey, because that tells them what they are getting.
   */
  it("hides claims from the owner while showing them to a giver", async () => {
    const noura = asShopper("noura");
    const [list] = await noura.wishlists.mine();
    await noura.wishlists.addItem({ listId: list.id, productId: "101", note: "the blue one" });

    const token = await noura.wishlists.shareLink({ listId: list.id });
    await asStranger().wishlists.claim({ token, productId: "101" });

    const asGiver = await asStranger().wishlists.byToken({ token });
    // By product id, never by index: another test putting something on this
    // list first is exactly how an index-based assertion starts lying.
    expect(asGiver.items.find((i: { productId: string }) => i.productId === "101").state).toBe("claimed");

    const asOwner = await noura.wishlists.get({ listId: list.id });
    for (const item of asOwner.items) {
      expect(item).not.toHaveProperty("claimedAt");
      expect(item).not.toHaveProperty("claimedBy");
      expect(item).not.toHaveProperty("state");
    }
    expect(JSON.stringify(asOwner)).not.toContain("claim");
  });

  /*
   * *Who* claimed it never leaves the server. `claimedByYou` does, and is
   * deliberate: it is a fact about the viewer rather than about anybody else,
   * and it is the only thing that makes the release control reachable. So the
   * assertion is about the id and the timestamp, not about the substring
   * "claimedBy" — which the first version of this test matched, and which
   * would now fail on the very field it was written to permit.
   */
  it("never tells a giver who else claimed something", async () => {
    const [list] = await asShopper("noura").wishlists.mine();
    const token = await asShopper("noura").wishlists.shareLink({ listId: list.id });
    const view = await asStranger().wishlists.byToken({ token });

    const item = view.items.find((i: { productId: string }) => i.productId === "101");
    expect(item).not.toHaveProperty("claimedBy");
    expect(item).not.toHaveProperty("claimedAt");
    expect(item.claimedByYou).toBe(false);
    // No user id under any spelling.
    for (const person of Object.values(people)) {
      expect(JSON.stringify(view)).not.toContain(person.email);
    }
  });

  /* And it does tell you about your own claim, or release would be unreachable. */
  it("tells a signed-in giver which items they took, and only those", async () => {
    const [list] = await asShopper("noura").wishlists.mine();
    const token = await asShopper("noura").wishlists.shareLink({ listId: list.id });

    const pick = (view: { items: { productId: string; claimedByYou: boolean }[] }) =>
      view.items.find(i => i.productId === "101");

    // The claim was made signed out, so it belongs to nobody in particular.
    expect(pick(await asShopper("aunt").wishlists.byToken({ token })).claimedByYou).toBe(false);
    expect(pick(await asShopper("salem").wishlists.byToken({ token })).claimedByYou).toBe(false);
  });
});

describe("claiming", () => {
  it("refuses a second claim, so one present is not bought twice", async () => {
    const [list] = await asShopper("noura").wishlists.mine();
    const token = await asShopper("noura").wishlists.shareLink({ listId: list.id });

    await expect(asStranger("10.0.0.7").wishlists.claim({ token, productId: "101" }))
      .rejects.toMatchObject({ message: "wishlist.alreadyClaimed" });
  });

  /* An aunt who pressed the button and forgot must not block it forever. */
  it("lets a lapsed claim be taken by somebody else", async () => {
    const [list] = await asShopper("noura").wishlists.mine();
    const token = await asShopper("noura").wishlists.shareLink({ listId: list.id });

    const old = new Date(Date.now() - (CLAIM_HOLD_DAYS + 1) * 24 * 60 * 60 * 1000);
    await db.update(wishlistItems).set({ claimedAt: old }).where(eq(wishlistItems.productId, "101"));

    await expect(asStranger("10.0.0.8").wishlists.claim({ token, productId: "101" })).resolves.toBeUndefined();
  });

  it("refuses a claim against a list nobody published", async () => {
    const salem = asShopper("salem");
    const mine = await salem.wishlists.mine();
    const secret = mine.find((l: { title: string }) => l.title === "Secret");
    // A private list has no share link at all, which is the first refusal.
    expect(await salem.wishlists.shareLink({ listId: secret.id })).toBeNull();
    await expect(asStranger().wishlists.claim({ token: "x".repeat(32), productId: "101" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /*
   * Unpublishing has to break links already pasted into a group chat, or
   * "private" only means "not findable by phone from now on".
   */
  it("kills an existing share link when a list goes private again", async () => {
    const noura = asShopper("noura");
    const [list] = await noura.wishlists.mine();
    const token = await noura.wishlists.shareLink({ listId: list.id });
    expect(await asStranger().wishlists.byToken({ token })).not.toBeNull();

    await noura.wishlists.update({ listId: list.id, visibility: "private" });
    expect(await asStranger().wishlists.byToken({ token })).toBeNull();

    // And republishing does not resurrect the old link.
    await noura.wishlists.update({ listId: list.id, visibility: "public" });
    expect(await asStranger().wishlists.byToken({ token })).toBeNull();
    const fresh = await noura.wishlists.shareLink({ listId: list.id });
    expect(fresh).not.toBe(token);
    expect(await asStranger().wishlists.byToken({ token: fresh })).not.toBeNull();
  });
});

describe("the lookup throttle", () => {
  /*
   * A lookup keyed on an eight-digit number is an enumeration oracle, and the
   * throttle is the only thing standing in front of it. Every request counts,
   * because there is no failed lookup to count.
   */
  it("counts a lookup that found nothing exactly as one that found something", async () => {
    await asStranger("10.1.1.1").wishlists.findByPhone({ phone: "99999999" });
    const [{ n }] = await db.select({ n: authAttempts.id }).from(authAttempts).where(eq(authAttempts.kind, "giftLookup"));
    expect(n).toBeTruthy();
  });

  it("stops answering an address that walks the number space", async () => {
    const walker = asStranger("10.2.2.2");
    for (let i = 0; i < MAX_LOOKUPS_PER_ADDRESS; i++) {
      await walker.wishlists.findByPhone({ phone: `5000${String(i).padStart(4, "0")}` });
    }
    await expect(walker.wishlists.findByPhone({ phone: "50123456" }))
      .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  /* Throttling one address must not lock out the rest of the internet. */
  it("does not throttle a different address", async () => {
    await expect(asStranger("10.3.3.3").wishlists.findByPhone({ phone: "50123456" })).resolves.toHaveLength(1);
  });

  /*
   * The refusal must not depend on whether the answer would have been
   * interesting, or the throttle is the oracle it was built to prevent.
   */
  it("refuses a throttled caller the same way for a real number and a dead one", async () => {
    const walker = asStranger("10.4.4.4");
    for (let i = 0; i < MAX_LOOKUPS_PER_ADDRESS; i++) {
      await walker.wishlists.findByPhone({ phone: `6000${String(i).padStart(4, "0")}` });
    }
    const real = await walker.wishlists.findByPhone({ phone: "50123456" }).catch((e: Error) => e);
    const dead = await walker.wishlists.findByPhone({ phone: "99999999" }).catch((e: Error) => e);
    expect((real as { code?: string }).code).toBe((dead as { code?: string }).code);
    expect((real as Error).message).toBe((dead as Error).message);
  });

  /* A pasted link is not guessable, so it is not behind the same door. */
  it("does not throttle a share token", async () => {
    const [list] = await asShopper("noura").wishlists.mine();
    const token = await asShopper("noura").wishlists.shareLink({ listId: list.id });
    for (let i = 0; i < MAX_LOOKUPS_PER_ADDRESS + 5; i++) {
      await asStranger("10.5.5.5").wishlists.byToken({ token });
    }
    expect(await asStranger("10.5.5.5").wishlists.byToken({ token })).not.toBeNull();
  });
});

describe("the phone number itself", () => {
  it("is stored canonically, whatever the shopper typed", async () => {
    const aunt = asShopper("aunt");
    await aunt.wishlists.setPhone({ phone: "  (+965) 9911-2233 " });
    expect(await aunt.wishlists.phone()).toBe("+96599112233");
    const [row] = await db.select().from(customerPreferences).where(eq(customerPreferences.userId, people.aunt.id));
    expect(row.wishlistPhone).toBe("+96599112233");
  });

  it("can be cleared, which takes the lists off the lookup", async () => {
    const aunt = asShopper("aunt");
    const id = await aunt.wishlists.create({ title: "Eid" });
    await aunt.wishlists.update({ listId: id, visibility: "public" });
    expect(await asStranger("10.6.6.6").wishlists.findByPhone({ phone: "99112233" })).toHaveLength(1);

    await aunt.wishlists.setPhone({ phone: null });
    expect(await asStranger("10.6.6.6").wishlists.findByPhone({ phone: "99112233" })).toEqual([]);
  });
});

describe("the heart's question", () => {
  let shopper: User;
  const caller = () => appRouter.createCaller(contextFor(shopper));
  const savedIds = async () =>
    (await db.select().from(savedProducts).where(eq(savedProducts.userId, shopper.id))).map(row => row.productId);

  beforeAll(async () => {
    [shopper] = await db.insert(users).values({ email: "hearts@example.test" }).returning();
  });

  it("makes the private list on the first heart and reuses it after, leaving Saved alone", async () => {
    const first = await caller().wishlists.wish({ productId: "41", visibility: "private", title: "My wishlist" });
    expect(first).toMatchObject({ title: "My wishlist", created: true });
    const second = await caller().wishlists.wish({ productId: "42", visibility: "private", title: "Another title" });
    expect(second).toEqual({ listId: first.listId, title: "My wishlist", created: false });

    const lists = await caller().wishlists.mine();
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ visibility: "private", itemCount: 2 });
    // A wishlist and Saved are two things, on the owner's word.
    expect(await savedIds()).toEqual([]);
    expect(await caller().wishlists.wishedIds()).toEqual(["41", "42"]);
  });

  it("puts a public heart on a public list, never the private one", async () => {
    const answer = await caller().wishlists.wish({ productId: "43", visibility: "public", title: "My public wishlist" });
    expect(answer.created).toBe(true);
    const lists = await caller().wishlists.mine();
    expect(lists.map((list: { visibility: string; itemCount: number }) => [list.visibility, list.itemCount])).toEqual([["private", 2], ["public", 1]]);
  });

  it("makes one list when two hearts land at once", async () => {
    const [other] = await db.insert(users).values({ email: "twice@example.test" }).returning();
    const twice = appRouter.createCaller(contextFor(other));
    const answers = await Promise.all([
      twice.wishlists.wish({ productId: "51", visibility: "public", title: "Mine" }),
      twice.wishlists.wish({ productId: "52", visibility: "public", title: "Mine" }),
    ]);
    expect(answers[0].listId).toBe(answers[1].listId);
    expect(await db.select().from(wishlists).where(eq(wishlists.userId, other.id))).toHaveLength(1);
  });

  it("is a no-op the second time, the item counted once", async () => {
    await caller().wishlists.wish({ productId: "41", visibility: "private", title: "My wishlist" });
    const [privateList] = await caller().wishlists.mine();
    expect(privateList.itemCount).toBe(2);
  });

  it("lists what is on the shopper's lists once each, and nobody else's", async () => {
    await asShopper("noura").wishlists.create({ title: "Not mine" }).then(list => asShopper("noura").wishlists.addItem({ listId: list, productId: "99" }));
    await caller().wishlists.wish({ productId: "42", visibility: "public", title: "My public wishlist" });
    expect(await caller().wishlists.wishedIds()).toEqual(["41", "42", "43"]);
  });

  it("takes a filled heart off Saved and every list of the shopper's, and nobody else's", async () => {
    await caller().customer.saved.set({ productId: "41", saved: true });
    await caller().wishlists.wish({ productId: "41", visibility: "public", title: "My public wishlist" });
    const nouraList = await asShopper("noura").wishlists.create({ title: "Hers" });
    await asShopper("noura").wishlists.addItem({ listId: nouraList, productId: "41" });

    expect(await caller().wishlists.unwish({ productId: "41" })).toEqual({ lists: 2 });
    expect(await savedIds()).not.toContain("41");
    const lists = await caller().wishlists.mine();
    expect(lists.map((list: { itemCount: number }) => list.itemCount)).toEqual([1, 2]);

    const { items } = await asShopper("noura").wishlists.get({ listId: nouraList });
    expect(items.map((item: { productId: string }) => item.productId)).toEqual(["41"]);
  });

  it("refuses a signed-out heart", async () => {
    await expect(asStranger().wishlists.wish({ productId: "1", visibility: "private", title: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
