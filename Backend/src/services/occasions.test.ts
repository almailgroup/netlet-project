/**
 * NetLet's own occasions against a real Postgres: what the home page and an
 * occasion's page are told, who runs the desk, what a save is held to, the
 * trail, and that the shop is the calendar's own — closed, not broken — before
 * migration 0081 is pasted.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, mediaFiles, occasionProducts, occasions, productImages, productVariants, products, users, vendorMembers, vendors } from "../../database/schema.js";
import { MAX_OCCASION_PRODUCTS } from "../../../Shared/commerce/occasionDesk.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let desk: typeof import("./occasions.js");
const ids = { admin: 0, owner: 0, acme: 0, closed: 0 };
const product: Record<string, number> = {};
const PICTURE = "/media/occasionpicture0001.webp";

async function add(vendorId: number, handle: string, options: { status?: "published" | "draft"; tags?: string[]; titleAr?: string } = {}) {
  const [row] = await db
    .insert(products)
    .values({ vendorId, handle, title: handle, titleAr: options.titleAr ?? null, status: options.status ?? "published", tags: options.tags ?? [] })
    .returning();
  await db.insert(productVariants).values({ productId: row.id, title: "Default", price: "5.000", stock: 10 });
  product[handle] = row.id;
}

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
  desk = await import("./occasions.js");
  ids.admin = (await db.insert(users).values({ email: "admin@netlet.test", name: "Nadia Admin", role: "admin" }).returning())[0].id;
  ids.owner = (await db.insert(users).values({ email: "owner@acme.test" }).returning())[0].id;
  ids.acme = (await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning())[0].id;
  ids.closed = (await db.insert(vendors).values({ slug: "closed", name: "Closed", status: "suspended" }).returning())[0].id;
  await db.insert(vendorMembers).values({ vendorId: ids.acme, userId: ids.owner, role: "owner" });
  await add(ids.acme, "lamp");
  await add(ids.acme, "kettle", { titleAr: "غلاية" });
  await add(ids.acme, "rug");
  await add(ids.acme, "scarf", { tags: ["Winter"] });
  await add(ids.acme, "heater", { tags: ["الشتاء", "white friday"] });
  await add(ids.acme, "sketch", { status: "draft", tags: ["winter"] });
  await add(ids.closed, "ghost", { tags: ["winter"] });
  await db.insert(productImages).values([
    { productId: product.lamp, url: "https://example.com/lamp-2.jpg", position: 1 },
    { productId: product.lamp, url: "https://example.com/lamp-1.jpg", position: 0 },
  ]);
  await db.insert(mediaFiles).values({ id: "occasionpicture0001", uploadedBy: ids.admin, contentType: "image/webp", bytes: new Uint8Array([1, 2, 3]), width: 1200, height: 400, byteSize: 3 });
}, 60_000);

beforeEach(async () => {
  await db.delete(occasions);
  await db.delete(auditLog);
});

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.acme, role: "owner" });
const shopper = (): Actor => ({ kind: "customer", userId: ids.owner });
/* Nine in the morning in Kuwait on the day named. */
const at = (day: string) => new Date(`${day}T06:00:00Z`);

const draft = (extra: Record<string, unknown> = {}) => ({
  slug: "white-friday",
  title: "White Friday",
  titleAr: "الجمعة البيضاء",
  imageUrl: null as string | null,
  startsOn: "2026-11-20" as string | null,
  endsOn: "2026-11-30" as string | null,
  includeTagged: true,
  productIds: [] as number[],
  ...extra,
});

async function published(extra: Record<string, unknown> = {}, now = at("2026-11-25")) {
  const saved = await desk.saveOccasion(admin(), null, draft(extra), now);
  return desk.setOccasionStatus(admin(), saved.id, "published", now);
}

describe("an occasion NetLet made", () => {
  it("starts as a draft that no shopper is told about", async () => {
    const saved = await desk.saveOccasion(admin(), null, draft({ title: "  White Friday ", productIds: [product.rug, product.lamp] }), at("2026-11-25"));
    expect(saved).toMatchObject({ slug: "white-friday", title: "White Friday", status: "draft", calendar: false, chosen: 2, live: 2, season: { state: "on", daysLeft: 5 } });
    expect(saved.products.map(one => one.title)).toEqual(["rug", "lamp"]);
    expect(await desk.liveOccasions("en", at("2026-11-25"))).toEqual({ ready: true, occasions: [], replaced: [] });
    expect(await desk.occasionBySlug("white-friday")).toEqual({ occasion: null, hidden: false, products: [] });
  });

  it("is on the home page while it is published and running, with the products chosen, in order", async () => {
    await published({ imageUrl: PICTURE, productIds: [product.rug, product.lamp, product.sketch, product.ghost] });
    const live = await desk.liveOccasions("en", at("2026-11-25"));
    expect(live.ready).toBe(true);
    expect(live.replaced).toEqual([]);
    expect(live.occasions).toHaveLength(1);
    expect(live.occasions[0]).toMatchObject({ slug: "white-friday", title: "White Friday", titleAr: "الجمعة البيضاء", imageUrl: PICTURE, includeTagged: true });
    /* A draft product and a suspended store's are chosen and not shown. */
    expect(live.occasions[0].products.map(one => one.handle)).toEqual(["rug", "lamp"]);
    expect((await desk.liveOccasions("en", at("2026-11-19"))).occasions).toEqual([]);
    expect((await desk.liveOccasions("en", at("2026-12-01"))).occasions).toEqual([]);
  });

  it("names its products in the page's language", async () => {
    await published({ productIds: [product.kettle] });
    expect((await desk.liveOccasions("ar", at("2026-11-25"))).occasions[0].products[0].title).toBe("غلاية");
    expect((await desk.occasionBySlug("white-friday", "ar")).products[0].title).toBe("غلاية");
  });

  it("keeps its page after its days, since a link somebody shared should not go dead", async () => {
    await published({ productIds: [product.lamp] });
    const page = await desk.occasionBySlug("white-friday");
    expect(page.occasion).toMatchObject({ slug: "white-friday", title: "White Friday" });
    expect(page.products.map(one => one.handle)).toEqual(["lamp"]);
  });

  it("leads with the one that started last, and sends no more than the page can use", async () => {
    await published({ slug: "early", title: "Early", startsOn: "2026-11-01", endsOn: "2026-11-30" });
    await published({ slug: "late", title: "Late", startsOn: "2026-11-24", endsOn: "2026-11-30" });
    await published({ slug: "winter", title: "Winter warmers", titleAr: "دفء الشتاء", startsOn: null, endsOn: null });
    expect((await desk.liveOccasions("en", at("2026-11-25"))).occasions.map(one => one.slug)).toEqual(["late", "early", "winter"]);
  });

  it("loses a product the shop deleted, by the cascade", async () => {
    await add(ids.acme, "gone");
    const saved = await desk.saveOccasion(admin(), null, draft({ productIds: [product.gone, product.lamp] }), at("2026-11-25"));
    await db.delete(products).where(eq(products.id, product.gone));
    expect((await desk.getOccasion(admin(), saved.id, at("2026-11-25"))).products.map(one => one.title)).toEqual(["lamp"]);
  });
});

describe("one of the calendar's occasions", () => {
  it("is taken over once NetLet's is published, and not by a draft", async () => {
    const saved = await desk.saveOccasion(admin(), null, draft({ slug: "winter", title: "Winter warmers", titleAr: "دفء الشتاء", startsOn: null, endsOn: null, productIds: [product.lamp] }), at("2026-11-25"));
    expect(saved).toMatchObject({ calendar: true, season: { state: "on", daysLeft: null }, chosen: 1, tagged: 2 });
    expect((await desk.liveOccasions("en", at("2026-11-25"))).replaced).toEqual([]);
    await desk.setOccasionStatus(admin(), saved.id, "published", at("2026-11-25"));
    const live = await desk.liveOccasions("en", at("2026-11-25"));
    expect(live.replaced).toEqual(["winter"]);
    expect(live.occasions.map(one => one.slug)).toEqual(["winter"]);
    /* Out of the calendar's season it is not drawn, and the calendar's own still must not be. */
    const summer = await desk.liveOccasions("en", at("2026-07-01"));
    expect(summer.occasions).toEqual([]);
    expect(summer.replaced).toEqual(["winter"]);
  });

  it("runs on NetLet's days when it is given some, in place of the calendar's", async () => {
    await published({ slug: "winter", title: "Winter", titleAr: "الشتاء", startsOn: "2026-12-01", endsOn: "2026-12-31" });
    const november = await desk.liveOccasions("en", at("2026-11-25"));
    expect(november.occasions).toEqual([]);
    expect(november.replaced).toEqual(["winter"]);
    expect((await desk.liveOccasions("en", at("2026-12-10"))).occasions.map(one => one.slug)).toEqual(["winter"]);
  });

  it("is switched off by hiding it, under the calendar's own names, and comes back", async () => {
    const hidden = await desk.hideCalendarOccasion(admin(), "halloween", at("2026-10-20"));
    expect(hidden).toMatchObject({ slug: "halloween", title: "Halloween", titleAr: "هالوين", status: "hidden", calendar: true });
    expect(await desk.liveOccasions("en", at("2026-10-20"))).toEqual({ ready: true, occasions: [], replaced: ["halloween"] });
    expect(await desk.occasionBySlug("halloween")).toEqual({ occasion: null, hidden: true, products: [] });
    /* A second press is the same answer, not a second row. */
    expect((await desk.hideCalendarOccasion(admin(), "halloween", at("2026-10-20"))).id).toBe(hidden.id);
    await desk.setOccasionStatus(admin(), hidden.id, "draft", at("2026-10-20"));
    expect((await desk.liveOccasions("en", at("2026-10-20"))).replaced).toEqual([]);
    const trail = await db.select().from(auditLog);
    expect(trail.map(entry => entry.action)).toEqual(["occasion.setStatus", "occasion.setStatus"]);
  });

  it("is the only kind that can be hidden", async () => {
    const saved = await desk.saveOccasion(admin(), null, draft(), at("2026-11-25"));
    await expect(desk.setOccasionStatus(admin(), saved.id, "hidden")).rejects.toMatchObject({ reason: "occasions.cannotHide" });
    await expect(desk.hideCalendarOccasion(admin(), "white-friday")).rejects.toMatchObject({ reason: "occasions.cannotHide" });
  });
});

describe("the desk", () => {
  it("is NetLet's alone", async () => {
    for (const actor of [owner(), shopper()]) {
      await expect(desk.listOccasions(actor)).rejects.toThrow("FORBIDDEN:platform.configure");
      await expect(desk.saveOccasion(actor, null, draft())).rejects.toThrow("FORBIDDEN:platform.configure");
      await expect(desk.hideCalendarOccasion(actor, "winter")).rejects.toThrow("FORBIDDEN:platform.configure");
      await expect(desk.deleteOccasion(actor, 1)).rejects.toThrow("FORBIDDEN:platform.configure");
    }
  });

  it("lists NetLet's own with their counts, and the calendar's ten with what stands over each", async () => {
    await published({ productIds: [product.lamp, product.sketch] });
    await desk.hideCalendarOccasion(admin(), "halloween", at("2026-11-25"));
    const list = await desk.listOccasions(admin(), at("2026-11-25"));
    expect(list.ready).toBe(true);
    const friday = list.rows.find(one => one.slug === "white-friday");
    /* Two chosen, one of them a draft; the heater is tagged for it by a store. */
    expect(friday).toMatchObject({ status: "published", chosen: 2, live: 1, tagged: 1, season: { state: "on", daysLeft: 5 } });
    expect(list.calendar).toHaveLength(10);
    const winter = list.calendar.find(one => one.slug === "winter");
    /* The scarf and the heater; never the draft or the suspended store's. */
    expect(winter).toEqual({ slug: "winter", on: true, tagged: 2, row: null });
    expect(list.calendar.find(one => one.slug === "halloween")).toMatchObject({ on: false, row: { status: "hidden" } });
  });

  it("gives the editor each chosen product's first photo, its store, and whether the shop shows it", async () => {
    const saved = await desk.saveOccasion(admin(), null, draft({ productIds: [product.lamp, product.ghost] }), at("2026-11-25"));
    expect((await desk.getOccasion(admin(), saved.id)).products).toEqual([
      { id: product.lamp, title: "lamp", titleAr: null, vendorName: "Acme", imageUrl: "https://example.com/lamp-1.jpg", live: true },
      { id: product.ghost, title: "ghost", titleAr: null, vendorName: "Closed", imageUrl: null, live: false },
    ]);
  });

  it("holds every save to the rule, whatever the form said", async () => {
    await expect(desk.saveOccasion(admin(), null, draft({ title: "" }))).rejects.toMatchObject({ reason: "occasions.needTitle" });
    await expect(desk.saveOccasion(admin(), null, draft({ slug: "White Friday" }))).rejects.toMatchObject({ reason: "occasions.badSlug" });
    await expect(desk.saveOccasion(admin(), null, draft({ startsOn: null, endsOn: null }))).rejects.toMatchObject({ reason: "occasions.needDates" });
    await expect(desk.saveOccasion(admin(), null, draft({ endsOn: "2026-11-01" }))).rejects.toMatchObject({ reason: "occasions.endsBeforeStart" });
    await expect(desk.saveOccasion(admin(), null, draft({ imageUrl: "https://example.com/a.jpg" }))).rejects.toMatchObject({ reason: "occasions.badPicture" });
    /* One of NetLet's paths that names no upload. */
    await expect(desk.saveOccasion(admin(), null, draft({ imageUrl: "/media/nosuchpicture00001.webp" }))).rejects.toMatchObject({ reason: "occasions.badPicture" });
    await expect(desk.saveOccasion(admin(), null, draft({ productIds: [999_999] }))).rejects.toMatchObject({ reason: "occasions.noSuchProduct" });
    await expect(desk.saveOccasion(admin(), null, draft({ productIds: Array.from({ length: MAX_OCCASION_PRODUCTS + 1 }, (_, n) => n + 1) }))).rejects.toMatchObject({ reason: "occasions.tooManyProducts" });
    expect(await db.select().from(occasions)).toEqual([]);
  });

  it("refuses an address another occasion has", async () => {
    await desk.saveOccasion(admin(), null, draft());
    await expect(desk.saveOccasion(admin(), null, draft({ title: "Another" }))).rejects.toMatchObject({ reason: "occasions.slugTaken" });
  });

  it("lets a draft change its address and keeps a published one's", async () => {
    const saved = await desk.saveOccasion(admin(), null, draft());
    expect((await desk.saveOccasion(admin(), saved.id, draft({ slug: "white-friday-2026" }))).slug).toBe("white-friday-2026");
    await desk.setOccasionStatus(admin(), saved.id, "published");
    const again = await desk.saveOccasion(admin(), saved.id, draft({ slug: "something-else", title: "White Friday week" }));
    expect(again).toMatchObject({ slug: "white-friday-2026", title: "White Friday week", status: "published" });
  });

  it("replaces the chosen products whole, in the new order", async () => {
    const saved = await desk.saveOccasion(admin(), null, draft({ productIds: [product.lamp, product.rug] }));
    const again = await desk.saveOccasion(admin(), saved.id, draft({ productIds: [product.kettle, product.lamp, product.kettle] }));
    expect(again.products.map(one => one.title)).toEqual(["kettle", "lamp"]);
    expect(await db.select().from(occasionProducts)).toHaveLength(2);
  });

  it("records publishing, taking down and deleting, and deletes the chosen products with it", async () => {
    const saved = await desk.saveOccasion(admin(), null, draft({ productIds: [product.lamp] }));
    await desk.setOccasionStatus(admin(), saved.id, "published");
    /* The same status again is no second act. */
    await desk.setOccasionStatus(admin(), saved.id, "published");
    await desk.setOccasionStatus(admin(), saved.id, "draft");
    await desk.deleteOccasion(admin(), saved.id);
    const trail = await db.select().from(auditLog).orderBy(auditLog.id);
    expect(trail.map(entry => [entry.action, entry.subjectLabel])).toEqual([
      ["occasion.setStatus", "White Friday"],
      ["occasion.setStatus", "White Friday"],
      ["occasion.delete", "White Friday"],
    ]);
    expect(await db.select().from(occasionProducts)).toEqual([]);
    await expect(desk.getOccasion(admin(), saved.id)).rejects.toMatchObject({ reason: "occasions.notFound" });
    await expect(desk.deleteOccasion(admin(), saved.id)).rejects.toMatchObject({ reason: "occasions.notFound" });
  });
});

describe("before migration 0081 is pasted", () => {
  it("the shop is the calendar's own and the desk says it is not open", async () => {
    await client.exec("ALTER TABLE occasions RENAME TO occasions_away");
    try {
      expect(await desk.liveOccasions("en")).toEqual({ ready: false, occasions: [], replaced: [] });
      expect(await desk.occasionBySlug("winter")).toEqual({ occasion: null, hidden: false, products: [] });
      expect(await desk.listOccasions(admin())).toEqual({ ready: false, rows: [], calendar: [] });
      await expect(desk.saveOccasion(admin(), null, draft())).rejects.toMatchObject({ reason: "occasions.unavailable" });
      await expect(desk.hideCalendarOccasion(admin(), "winter")).rejects.toMatchObject({ reason: "occasions.unavailable" });
      await expect(desk.getOccasion(admin(), 1)).rejects.toMatchObject({ reason: "occasions.unavailable" });
      await expect(desk.deleteOccasion(admin(), 1)).rejects.toMatchObject({ reason: "occasions.unavailable" });
    } finally {
      await client.exec("ALTER TABLE occasions_away RENAME TO occasions");
    }
  });
});
