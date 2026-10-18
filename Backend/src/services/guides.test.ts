/**
 * Guides (3.5.3) against a real Postgres, with the gateway stood in.
 *
 * What is proved: only NetLet writes them, only published ones are read in
 * public, publishing asks the rule again whatever the page said, a published
 * guide keeps its address while a draft's follows its title, the model's
 * draft is held to the guide's shape and counted, and publishing and deleting
 * are on the audit trail.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, authAttempts, guides, users } from "../../database/schema.js";
import { MAX_GUIDE_DRAFTS_PER_HOUR } from "../../../Shared/commerce/aiImages.js";
import type { GuideContent } from "../../../Shared/commerce/guides.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let mod: typeof import("./guides.js");
const admin: Actor = { kind: "admin", userId: 0 };
const manager: Actor = { kind: "vendor", userId: 0, vendorId: 1, role: "owner" };

let modelOn = true;
let answer: string | null = null;
let asked: { task: string; system: string; prompt: string }[] = [];

const step = { title: "Open your orders", titleAr: "افتح طلباتك", body: "Tap Profile, then Orders and returns.", bodyAr: "اضغط حسابي ثم الطلبات والإرجاع.", imageUrl: null };
const content = (change: Partial<GuideContent> = {}): GuideContent => ({
  audience: "shopper",
  title: "How to return an item",
  titleAr: "كيف تُرجع منتجاً",
  summary: "Three short steps.",
  summaryAr: "ثلاث خطوات قصيرة.",
  steps: [step],
  ...change,
});

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db.js")>()), getDb: async () => db }));
  vi.doMock("./gemini", async importOriginal => ({
    ...(await importOriginal<typeof import("./gemini.js")>()),
    modelAvailable: async () => modelOn,
    askModel: async (task: string, call: { system: string; prompt: string }) => {
      asked.push({ task, system: call.system, prompt: call.prompt });
      return answer;
    },
  }));
  mod = await import("./guides.js");
  const [boss] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [owner] = await db.insert(users).values({ email: "owner@acme.test", role: "user" }).returning();
  Object.assign(admin, { userId: boss.id });
  Object.assign(manager, { userId: owner.id });
}, 60_000);

beforeEach(async () => {
  await db.delete(guides);
  await db.delete(authAttempts);
  modelOn = true;
  answer = null;
  asked = [];
});

describe("who writes guides", () => {
  it("is NetLet alone: a store's owner is refused every act", async () => {
    await expect(mod.listGuides(manager)).rejects.toThrow("FORBIDDEN:platform.configure");
    await expect(mod.saveGuide(manager, null, content())).rejects.toThrow("FORBIDDEN:platform.configure");
    await expect(mod.draftGuide(manager, "returns", "shopper")).rejects.toThrow("FORBIDDEN:platform.configure");
  });
});

describe("drafts and the public", () => {
  it("never shows a draft, and shows a published guide by its address", async () => {
    const saved = await mod.saveGuide(admin, null, content());
    expect(saved.slug).toBe("how-to-return-an-item");
    expect(saved.status).toBe("draft");
    expect(await mod.publishedGuides()).toEqual([]);
    expect(await mod.guideBySlug(saved.slug)).toBeNull();

    await mod.setGuideStatus(admin, saved.id, "published");
    const [card] = await mod.publishedGuides();
    expect(card).toMatchObject({ slug: "how-to-return-an-item", stepCount: 1, audience: "shopper" });
    expect((await mod.guideBySlug(saved.slug))?.steps).toHaveLength(1);
    expect(await mod.publishedGuides({ audience: "seller" })).toEqual([]);
  });

  it("refuses to publish what the rule refuses, whatever the page said", async () => {
    const saved = await mod.saveGuide(admin, null, content({ steps: [{ ...step, bodyAr: "" }] }));
    await expect(mod.setGuideStatus(admin, saved.id, "published")).rejects.toMatchObject({ reason: "guides.stepIncomplete" });
    const withNumber = await mod.saveGuide(admin, null, content({ title: "Call us", summary: "Ring 99887766" }));
    await expect(mod.setGuideStatus(admin, withNumber.id, "published")).rejects.toMatchObject({ reason: "guides.contactDetails" });
  });

  it("keeps a published guide whole: an edit that breaks it is refused, not half-published", async () => {
    const saved = await mod.saveGuide(admin, null, content());
    await mod.setGuideStatus(admin, saved.id, "published");
    await expect(mod.saveGuide(admin, saved.id, content({ titleAr: "" }))).rejects.toMatchObject({ reason: "guides.needTitle" });
    expect((await mod.guideBySlug(saved.slug))?.titleAr).toBe("كيف تُرجع منتجاً");
  });
});

describe("a guide's address", () => {
  it("follows a draft's title, never another guide's, and stays put once published", async () => {
    const first = await mod.saveGuide(admin, null, content());
    const second = await mod.saveGuide(admin, null, content());
    expect(second.slug).toBe("how-to-return-an-item-2");
    const renamed = await mod.saveGuide(admin, first.id, content({ title: "Returning something" }));
    expect(renamed.slug).toBe("returning-something");
    await mod.setGuideStatus(admin, first.id, "published");
    const edited = await mod.saveGuide(admin, first.id, content({ title: "Returns, step by step" }));
    expect(edited.slug).toBe("returning-something");
  });
});

describe("the audit trail", () => {
  it("records publishing, taking down and deleting", async () => {
    const saved = await mod.saveGuide(admin, null, content());
    await mod.setGuideStatus(admin, saved.id, "published");
    await mod.setGuideStatus(admin, saved.id, "draft");
    await mod.deleteGuide(admin, saved.id);
    const rows = await db.select({ action: auditLog.action, after: auditLog.after }).from(auditLog).where(and(eq(auditLog.subjectType, "guide"), eq(auditLog.subjectId, saved.id)));
    expect(rows.map(row => row.action)).toEqual(["guide.setStatus", "guide.setStatus", "guide.delete"]);
    await expect(mod.deleteGuide(admin, saved.id)).rejects.toMatchObject({ reason: "guides.notFound" });
  });
});

describe("drafting with the model", () => {
  it("sends the topic fenced and the shop's facts, and returns the draft unsaved", async () => {
    answer = JSON.stringify({
      title: "Track an order",
      titleAr: "تتبّع طلباً",
      summary: "Where your parcel is.",
      summaryAr: "أين طردك.",
      steps: [{ title: "Open Profile", titleAr: "افتح حسابي", body: "Tap Profile at the foot of the screen.", bodyAr: "اضغط حسابي أسفل الشاشة." }],
    });
    const draft = await mod.draftGuide(admin, "how to track an order", "shopper");
    expect(draft.title).toBe("Track an order");
    expect(draft.steps[0].imageUrl).toBeNull();
    expect(asked[0].task).toBe("guideDraft");
    expect(asked[0].prompt).toBe("Topic:\n<<<how to track an order>>>");
    expect(asked[0].system).toContain("Orders and returns");
    expect(await db.select().from(guides)).toEqual([]);
  });

  it("answers a model that is off, a reply that is not a guide, and the hour's allowance", async () => {
    modelOn = false;
    await expect(mod.draftGuide(admin, "returns", "shopper")).rejects.toMatchObject({ reason: "drawing.off" });
    modelOn = true;
    answer = "not json";
    await expect(mod.draftGuide(admin, "returns", "shopper")).rejects.toMatchObject({ reason: "drawing.failed" });
    for (let n = 1; n < MAX_GUIDE_DRAFTS_PER_HOUR; n += 1) await mod.draftGuide(admin, "returns", "shopper").catch(() => undefined);
    await expect(mod.draftGuide(admin, "returns", "shopper")).rejects.toMatchObject({ reason: "drawing.tooMany" });
  });
});
