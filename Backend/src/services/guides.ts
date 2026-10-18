/**
 * Illustrated guides (3.5.3) — the database half of `Shared/commerce/guides.ts`.
 *
 * Reading is public and sees only what is published. Everything else —
 * listing drafts, saving, publishing, deleting, asking the model for a draft —
 * is NetLet's (`platform.configure`), because a guide is NetLet speaking to
 * every shopper or every seller. Publishing asks `guideProblems` again here,
 * whatever the editor's button said, and is audited with the deletion.
 *
 * The draft is a model's and is handed back to the editor, never stored: the
 * administrator reads it, changes it and saves it, so every guide on the shop
 * is one a person accepted. Its pictures are drawn one step at a time on the
 * editor's press (`aiImages.drawGuidePicture`) and uploaded like any photo.
 */
import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import { guides } from "../../database/schema.js";
import { translate } from "../../../Shared/i18n/dictionary.js";
import {
  GUIDE_TOPIC_MAX,
  guideDraftPrompt,
  guideDraftSystem,
  guideFromModel,
  guideProblems,
  guideSlug,
  type GuideAudience,
  type GuideContent,
  type GuideStatus,
  type GuideStep,
} from "../../../Shared/commerce/guides.js";
import { MAX_GUIDE_DRAFTS_PER_HOUR } from "../../../Shared/commerce/aiImages.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../../../Shared/pagination.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { recordAudit } from "./audit.js";
import { askModel, modelAvailable, parseObject } from "./gemini.js";
import { auditActor } from "./inventory.js";
import { takeHourlyAllowance } from "./rateLimit.js";
import { getDb } from "./db.js";

export type GuideProblem =
  | "guides.notFound"
  | "guides.needTitle"
  | "guides.needSteps"
  | "guides.stepIncomplete"
  | "guides.badPicture"
  | "guides.contactDetails"
  | "drawing.off"
  | "drawing.tooMany"
  | "drawing.failed";

export class GuideRefused extends Error {
  constructor(readonly reason: GuideProblem) {
    super(reason);
    this.name = "GuideRefused";
  }
}

/** What a list of guides shows: enough for a card, never the steps. */
export type GuideCard = {
  slug: string;
  audience: GuideAudience;
  title: string;
  titleAr: string;
  summary: string;
  summaryAr: string;
  /** The first step's picture, for the card. */
  imageUrl: string | null;
  stepCount: number;
  publishedAt: Date | null;
};

export type PublicGuide = GuideCard & { steps: GuideStep[]; updatedAt: Date };

export type AdminGuide = GuideContent & { id: number; slug: string; status: GuideStatus; publishedAt: Date | null; updatedAt: Date };

type Row = typeof guides.$inferSelect;

function card(row: Row): GuideCard {
  return {
    slug: row.slug,
    audience: row.audience,
    title: row.title,
    titleAr: row.titleAr,
    summary: row.summary ?? "",
    summaryAr: row.summaryAr ?? "",
    imageUrl: row.steps.find(step => step.imageUrl)?.imageUrl ?? null,
    stepCount: row.steps.length,
    publishedAt: row.publishedAt,
  };
}

function forAdmin(row: Row): AdminGuide {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    audience: row.audience,
    title: row.title,
    titleAr: row.titleAr,
    summary: row.summary ?? "",
    summaryAr: row.summaryAr ?? "",
    steps: row.steps,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------------------------------------ public --- */

/** Published guides, newest first, for `/guides`, the home page and Help. */
export async function publishedGuides(options: { audience?: GuideAudience; limit?: number } = {}): Promise<GuideCard[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(guides)
    .where(and(eq(guides.status, "published"), options.audience ? eq(guides.audience, options.audience) : undefined))
    .orderBy(desc(guides.publishedAt), desc(guides.id))
    .limit(Math.min(Math.max(options.limit ?? 60, 1), 100));
  return rows.map(card);
}

/** One published guide by its address; a draft is the same null as an address nobody has. */
export async function guideBySlug(slug: string): Promise<PublicGuide | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(guides).where(and(eq(guides.slug, slug), eq(guides.status, "published"))).limit(1);
  return row ? { ...card(row), steps: row.steps, updatedAt: row.updatedAt } : null;
}

/* ------------------------------------------------------------- admin --- */

export async function listGuides(actor: Actor, options: { page?: number; pageSize?: number } = {}): Promise<Page<AdminGuide>> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  const pageSize = clampPageSize(options.pageSize);
  if (!db) return { rows: [], total: 0, page: 1, pageSize };
  const [{ total }] = await db.select({ total: count() }).from(guides);
  const page = clampPage(options.page ?? 1, total, pageSize);
  const rows = await db.select().from(guides).orderBy(desc(guides.updatedAt), desc(guides.id)).limit(pageSize).offset(offsetFor(page, pageSize));
  return { rows: rows.map(forAdmin), total, page, pageSize };
}

export async function getGuide(actor: Actor, id: number): Promise<AdminGuide> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) throw new GuideRefused("guides.notFound");
  const [row] = await db.select().from(guides).where(eq(guides.id, id)).limit(1);
  if (!row) throw new GuideRefused("guides.notFound");
  return forAdmin(row);
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** A slug no other guide has: the title's, then `-2`, `-3`… */
async function freeSlug(db: Db, title: string, ownId: number | null): Promise<string> {
  const base = guideSlug(title);
  for (let n = 1; n <= 50; n += 1) {
    const slug = n === 1 ? base : `${base.slice(0, 96)}-${n}`;
    const [taken] = await db
      .select({ id: guides.id })
      .from(guides)
      .where(and(eq(guides.slug, slug), ownId === null ? undefined : ne(guides.id, ownId)))
      .limit(1);
    if (!taken) return slug;
  }
  return `${base.slice(0, 90)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Write a guide's words and steps. A published guide stays published only if
 * it still passes — an edit that empties a step's Arabic takes it off the shop
 * rather than publishing half a guide — and keeps its address; a draft's
 * address follows its title.
 */
export async function saveGuide(actor: Actor, id: number | null, content: GuideContent): Promise<AdminGuide> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) throw new GuideRefused("guides.notFound");
  const now = new Date();
  const values = {
    audience: content.audience,
    title: content.title.trim(),
    titleAr: content.titleAr.trim(),
    summary: content.summary.trim() || null,
    summaryAr: content.summaryAr.trim() || null,
    steps: content.steps.map(step => ({ ...step, title: step.title.trim(), titleAr: step.titleAr.trim(), body: step.body.trim(), bodyAr: step.bodyAr.trim() })),
    updatedAt: now,
  };
  if (id === null) {
    const slug = await freeSlug(db, values.title || values.titleAr, null);
    const [row] = await db.insert(guides).values({ ...values, slug, status: "draft", createdBy: actor.userId }).returning();
    return forAdmin(row);
  }
  const [current] = await db.select().from(guides).where(eq(guides.id, id)).limit(1);
  if (!current) throw new GuideRefused("guides.notFound");
  if (current.status === "published") {
    const problems = guideProblems(content);
    if (problems.length > 0) throw new GuideRefused(problems[0] as GuideProblem);
  }
  const slug = current.status === "draft" ? await freeSlug(db, values.title || values.titleAr, id) : current.slug;
  const [row] = await db.update(guides).set({ ...values, slug }).where(eq(guides.id, id)).returning();
  return forAdmin(row);
}

export async function setGuideStatus(actor: Actor, id: number, status: GuideStatus): Promise<AdminGuide> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) throw new GuideRefused("guides.notFound");
  const [current] = await db.select().from(guides).where(eq(guides.id, id)).limit(1);
  if (!current) throw new GuideRefused("guides.notFound");
  if (status === "published") {
    const problems = guideProblems(forAdmin(current));
    if (problems.length > 0) throw new GuideRefused(problems[0] as GuideProblem);
  }
  if (current.status === status) return forAdmin(current);
  const [row] = await db
    .update(guides)
    .set({ status, publishedAt: status === "published" ? current.publishedAt ?? new Date() : current.publishedAt, updatedAt: new Date() })
    .where(eq(guides.id, id))
    .returning();
  await recordAudit(await auditActor(actor), {
    action: "guide.setStatus",
    subjectType: "guide",
    subjectId: id,
    subjectLabel: current.title,
    before: { status: current.status },
    after: { status },
  });
  return forAdmin(row);
}

export async function deleteGuide(actor: Actor, id: number): Promise<void> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) throw new GuideRefused("guides.notFound");
  const [gone] = await db.delete(guides).where(eq(guides.id, id)).returning({ title: guides.title, status: guides.status });
  if (!gone) throw new GuideRefused("guides.notFound");
  await recordAudit(await auditActor(actor), {
    action: "guide.delete",
    subjectType: "guide",
    subjectId: id,
    subjectLabel: gone.title,
    before: { status: gone.status },
  });
}

/* ------------------------------------------------------------- draft --- */

/**
 * A model's draft of a guide on a topic, in both languages, from the help
 * page's answers and the site's own labels. Handed back, never saved.
 */
export async function draftGuide(actor: Actor, topic: string, audience: GuideAudience): Promise<GuideContent> {
  assertCan(actor, "platform.configure");
  const flat = topic.replace(/\s+/g, " ").trim().slice(0, GUIDE_TOPIC_MAX);
  if (!flat) throw new GuideRefused("guides.needTitle");
  if (!(await modelAvailable())) throw new GuideRefused("drawing.off");
  if (!(await takeHourlyAllowance(actor.userId, "guideDraft", MAX_GUIDE_DRAFTS_PER_HOUR))) throw new GuideRefused("drawing.tooMany");
  const text = await askModel("guideDraft", {
    system: guideDraftSystem(audience, (key, params) => translate("en", key, params)),
    prompt: guideDraftPrompt(flat),
    json: true,
    temperature: 0.4,
    maxOutputTokens: 3000,
    deadlineMs: 30_000,
  });
  const draft = guideFromModel(parseObject(text), audience);
  if (!draft) throw new GuideRefused("drawing.failed");
  return draft;
}

/** The order the public list is in, for the sitemap: every published guide's address. */
export async function publishedGuideSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ slug: guides.slug, updatedAt: guides.updatedAt }).from(guides).where(eq(guides.status, "published")).orderBy(asc(guides.id));
}
