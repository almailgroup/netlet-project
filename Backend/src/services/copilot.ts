/**
 * The portal's co-pilot, the server half: the facts for the person asking,
 * the brief, and one answer from the model (`Shared/ai/copilot.ts` is the
 * rule).
 *
 * The facts are built from the reads the person's own pages make — the
 * dashboard, the stock list, the waiting counts, NetLet's inbox — each only
 * where that person may read it, so the co-pilot cannot say what their pages
 * would not. The reads go together: each is a round trip.
 *
 * It carries out nothing. The two acts it may propose are done by the page,
 * on Confirm, through `inventory.variants.setReorderPoint` or a link — the
 * procedures the stock page already calls, which ask their own permission.
 */
import { DEPARTMENTS } from "../../../Shared/commerce/departments.js";
import { daysOfCover } from "../../../Shared/commerce/dashboard.js";
import {
  briefFrom,
  COPILOT_INQUIRIES,
  COPILOT_PAGES,
  COPILOT_SHELVES,
  copilotPieces,
  copilotProblem,
  copilotPrompt,
  copilotSystem,
  inquiryText,
  MAX_COPILOT_PER_HOUR,
  reorderFor,
  type CopilotAction,
  type CopilotFacts,
  type CopilotPage,
  type CopilotTurn,
  type Insight,
} from "../../../Shared/ai/copilot.js";
import { assertCan, can, type Actor, type Capability } from "../../../Shared/inventory/permissions.js";
import { kuwaitDay } from "../../../Shared/kuwaitDay.js";
import { fromFils, toFils } from "../../../Shared/money.js";
import { translate } from "../../../Shared/i18n/dictionary.js";
import { gatewayAvailable } from "./aiGateway.js";
import { dashboard, stockHealth } from "./dashboard.js";
import { askModel } from "./gemini.js";
import { lowStock, overview } from "./inventory.js";
import { takeHourlyAllowance } from "./rateLimit.js";
import { countWaitingReturns } from "./returns.js";
import { countWaitingApplications } from "./applications.js";
import { waitingInquiries, waitingOnStaff } from "./support.js";

const scopeOf = (actor: Actor) => (actor.kind === "vendor" ? actor.vendorId : undefined);
const may = (actor: Actor, capability: Capability) => can(actor, capability, scopeOf(actor));

/** A read the person may not make, or that failed, is left out rather than failing the whole brief. */
async function quietly<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    console.warn("[copilot] a read was left out:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function copilotFacts(actor: Actor, now = new Date()): Promise<CopilotFacts> {
  assertCan(actor, "product.view", scopeOf(actor));
  const admin = actor.kind === "admin";
  const [board, shelf, low, counts, returns, applications, support, inquiries] = await Promise.all([
    may(actor, "payouts.view") ? quietly(() => dashboard(actor, 30, now)) : Promise.resolve(null),
    quietly(() => stockHealth(actor)),
    quietly(() => lowStock(actor, { pageSize: COPILOT_SHELVES }, now)),
    admin ? quietly(() => overview(actor)) : Promise.resolve(null),
    may(actor, "returns.handle") ? quietly(() => countWaitingReturns(actor)) : Promise.resolve(null),
    may(actor, "platform.manageUsers") ? quietly(() => countWaitingApplications(actor)) : Promise.resolve(null),
    may(actor, "support.answer") ? quietly(() => waitingOnStaff(actor)) : Promise.resolve(null),
    may(actor, "support.answer") ? quietly(() => waitingInquiries(actor, COPILOT_INQUIRIES, now)) : Promise.resolve(null),
  ]);

  const pages = (Object.keys(COPILOT_PAGES) as CopilotPage[]).filter(page => may(actor, COPILOT_PAGES[page]));
  const waiting: CopilotFacts["waiting"] = [];
  const add = (page: CopilotPage, label: Parameters<typeof translate>[1], count: number | null | undefined) => {
    if (count && count > 0) waiting.push({ page, label, what: translate("en", label), count });
  };
  add("/admin/review", "copilot.waitReview", counts?.pendingReview);
  add("/admin/returns", "copilot.waitReturns", returns);
  add("/admin/applications", "copilot.waitApplications", applications);
  add("/admin/support", "copilot.waitSupport", support);

  const name = (slug: string | null, other?: boolean) =>
    other ? "Other departments" : DEPARTMENTS.find(department => department.slug === slug)?.name ?? "Not in a department";

  return {
    today: kuwaitDay(now),
    ...(board
      ? {
          sales: {
            days: board.range,
            total: board.totals.sales.current,
            previous: board.totals.sales.previous,
            change: board.totals.sales.change,
            orders: board.totals.orders.current,
            averageOrder: board.totals.averageOrder.current,
            customers: board.totals.customers.current,
            forecastNext7: fromFils(board.forecast.reduce((sum, day) => sum + toFils(day.sales), 0n)),
            last14: board.days.slice(-14).map(day => ({ day: day.day, sales: day.sales })),
            departments: board.departments.map(entry => ({ slug: entry.slug, name: name(entry.slug, entry.other), sales: entry.sales, percent: entry.percent })),
          },
        }
      : {}),
    stock: {
      ...(shelf ?? board?.stock ?? { healthy: 0, low: 0, out: 0, preorder: 0 }),
      lowest: (low?.rows ?? []).map(row => ({
        variantId: row.variantId,
        product: row.productTitle,
        variant: row.variantTitle,
        stock: row.stock,
        reorderAt: row.lowStockAt,
        soldLast28: row.soldLately,
        daysOfCover: daysOfCover(row.stock, row.soldLately),
        suggestedReorderAt: reorderFor(row.soldLately),
      })),
    },
    waiting,
    ...(inquiries ? { inquiries: inquiries.map(entry => ({ topic: entry.topic, waitingHours: entry.waitingHours, lastMessage: inquiryText(entry.lastMessage) })) } : {}),
    pages,
  };
}

/** Whether the model may answer: the gateway configured and the `ai` switch on. */
export async function copilotAvailable(): Promise<boolean> {
  return gatewayAvailable();
}

/** The brief, whether a question can be asked, and how many customers wait (so the panel offers to summarise them). */
export async function copilotBrief(actor: Actor, now = new Date()): Promise<{ insights: Insight[]; ask: boolean; inquiries: number }> {
  const facts = await copilotFacts(actor, now);
  return { insights: briefFrom(facts), ask: await copilotAvailable(), inquiries: facts.inquiries?.length ?? 0 };
}

export type CopilotAnswer =
  | { kind: "answer"; text: string; actions: CopilotAction[] }
  | { kind: "unavailable" }
  | { kind: "tooMany" }
  | { kind: "refused"; reason: string };

export async function askCopilot(actor: Actor, input: { turns: CopilotTurn[]; locale: "en" | "ar" }, now = new Date()): Promise<CopilotAnswer> {
  assertCan(actor, "product.view", scopeOf(actor));
  const last = [...input.turns].reverse().find(turn => turn.role === "admin");
  if (!last) return { kind: "refused", reason: "copilot.empty" };
  const problem = copilotProblem(last.text);
  if (problem) return { kind: "refused", reason: problem };
  if (!(await copilotAvailable())) return { kind: "unavailable" };
  if (!(await takeHourlyAllowance(actor.userId, "adminCopilot", MAX_COPILOT_PER_HOUR))) return { kind: "tooMany" };

  const facts = await copilotFacts(actor, now);
  /* Earlier questions are kept only if they too are clean. */
  const turns = input.turns.filter(turn => turn.role === "copilot" || copilotProblem(turn.text) === null);
  const text = await askModel("adminCopilot", {
    system: copilotSystem(input.locale),
    prompt: copilotPrompt(facts, turns),
    json: false,
    temperature: 0.2,
    maxOutputTokens: 700,
    deadlineMs: 15_000,
  });
  if (!text) return { kind: "unavailable" };
  const read = copilotPieces(text, facts);
  if (!read.text && read.actions.length === 0) return { kind: "unavailable" };
  return { kind: "answer", ...read };
}

