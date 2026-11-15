/**
 * Every API route, as a function from a Request to a Response, so the same
 * code answers on Vercel, on a laptop and in the tests.
 *
 *   GET    /api/health                       is the server up, and with what
 *   GET    /api/config                       what the pages need to know
 *   GET    /api/track/:number                one parcel, nothing personal
 *   POST   /api/ai/ask                       a question for ShipLee AI
 *   GET    /api/staff/session                signed in, and is the desk open
 *   POST   /api/staff/session                sign in
 *   DELETE /api/staff/session                sign out
 *   GET    /api/staff/summary                the day at a glance
 *   GET    /api/staff/shipments?q=&page=&group=  the list, with each group's count
 *   GET    /api/staff/export?q=&group=&lang=     the same list as a spreadsheet
 *   POST   /api/staff/ai/intake              an order message read into the form
 *   POST   /api/staff/shipments              a new shipment
 *   GET    /api/staff/shipments/:id          one, with the recipient's details
 *   PATCH  /api/staff/shipments/:id          its details changed
 *   POST   /api/staff/shipments/:id/events   an update added
 *
 * An error is a key the pages say in words, never a database's sentence.
 */
import { randomInt } from "node:crypto";
import type { Store } from "./store.js";
import { DuplicateNumber } from "./store.js";
import type { StaffKey } from "./auth.js";
import { clearedCookie, COOKIE, FAILURE_WINDOW_MS, makeSession, MAX_FAILURES, passwordMatches, readCookie, sessionCookie, sessionValid } from "./auth.js";
import type { Contact } from "./contact.js";
import type { Seams, ShipLeeAI } from "./gateway.js";
import { answerQuestion, readOrderMessage } from "./ai.js";
import { shipmentsCsv } from "./csv.js";
import { isStatusGroup } from "../shared/status.js";
import { kuwaitDay } from "../shared/kuwait.js";
import { makeTrackingNumber, parseTrackingNumber } from "../shared/tracking.js";
import { publicView, shipmentProblems, updateProblems } from "../shared/shipment.js";
import { demoParcels } from "../shared/demo.js";

export type Context = {
  store: Store | null;
  staff: StaffKey | null;
  contact: Contact;
  /** ShipLee AI's line to the gateway, or null when it is not set up. */
  ai: ShipLeeAI | null;
  /** The network and the clock ShipLee AI's calls use; the tests hand in a stand-in gateway. */
  aiSeams?: Seams;
  now?: () => Date;
  /** One random digit, 0 to 9. The tests hand in a fixed sequence. */
  randomDigit?: () => number;
};

const MAX_BODY = 16 * 1024;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
const refuse = (status: number, error: string, headers?: Record<string, string>) => json(status, { error }, headers);

/** The path asked for. On Vercel every /api path is rewritten onto the one function with `?route=`. */
function routeOf(url: URL): string[] {
  const route = url.searchParams.get("route");
  const path = url.pathname.replace(/\/+$/, "") === "/api" && route !== null ? `/api/${route}` : url.pathname;
  return path.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
}

/** The caller's address, as Vercel's edge gives it. Only a key for counting failures. */
function addressOf(request: Request): string {
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * A request that changes something must say it is JSON and, when the browser
 * names its page, come from this site's own: a form on another site can send
 * neither, so a signed-in staff browser cannot be made to post by one.
 */
function sameSiteJson(request: Request): boolean {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const value: unknown = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const secureFor = (request: Request) => new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";

export async function handle(request: Request, ctx: Context): Promise<Response> {
  try {
    return await route(request, ctx);
  } catch (error) {
    /* What failed, never what was sent: a body can hold a recipient's phone. */
    console.error("[shiplee] request failed:", request.method, new URL(request.url).pathname, error instanceof Error ? error.message : error);
    return refuse(500, "server");
  }
}

async function route(request: Request, ctx: Context): Promise<Response> {
  const now = ctx.now ?? (() => new Date());
  const url = new URL(request.url);
  const parts = routeOf(url);
  const method = request.method.toUpperCase();
  const [first, second, third, fourth] = parts;

  if (first === "health" && parts.length === 1 && method === "GET") {
    return json(200, { ok: true, store: ctx.store?.kind ?? null, staff: Boolean(ctx.staff) });
  }

  if (first === "config" && parts.length === 1 && method === "GET") {
    const demo = ctx.store?.kind === "demo";
    return json(200, {
      tracking: Boolean(ctx.store),
      /* ShipLee AI needs somewhere to count each caller's questions, so it is offered only beside a store. */
      ai: Boolean(ctx.ai && ctx.store),
      demo,
      samples: demo ? demoParcels(now()).map(parcel => parcel.trackingNumber) : [],
      contact: ctx.contact,
    });
  }

  if (first === "track" && parts.length === 2 && method === "GET") {
    const parsed = parseTrackingNumber(second ?? "");
    if (!parsed.ok) return refuse(400, `badNumber.${parsed.reason}`);
    if (!ctx.store) return refuse(503, "notSetUp");
    const shipment = await ctx.store.byNumber(parsed.number);
    return shipment ? json(200, publicView(shipment)) : refuse(404, "notFound");
  }

  if (first === "ai" && second === "ask" && parts.length === 2) {
    if (method !== "POST") return refuse(405, "method");
    if (!sameSiteJson(request)) return refuse(403, "notJson");
    if (!ctx.ai || !ctx.store) return refuse(503, "ai.off");
    const body = await bodyOf(request);
    if (!body) return refuse(400, "badBody");
    const outcome = await answerQuestion(body, { ai: ctx.ai, store: ctx.store, contact: ctx.contact, address: addressOf(request), now: now(), seams: ctx.aiSeams });
    return outcome.ok ? json(200, outcome.value) : refuse(outcome.status, outcome.error);
  }

  if (first === "staff") return staffRoute(request, ctx, { second, third, fourth, method, parts, url, now });

  return refuse(404, "noRoute");
}

async function staffRoute(
  request: Request,
  ctx: Context,
  { second, third, fourth, method, parts, url, now }: { second?: string; third?: string; fourth?: string; method: string; parts: string[]; url: URL; now: () => Date },
): Promise<Response> {
  const secure = secureFor(request);
  const signedIn = Boolean(ctx.staff && sessionValid(ctx.staff, readCookie(request.headers.get("cookie"), COOKIE), now()));

  if (second === "session" && parts.length === 2) {
    if (method === "GET") return json(200, { open: Boolean(ctx.staff && ctx.store), signedIn, store: ctx.store?.kind ?? null, staff: Boolean(ctx.staff) });
    if (!sameSiteJson(request)) return refuse(403, "notJson");
    if (method === "DELETE") return json(204, null, { "set-cookie": clearedCookie(secure) });
    if (method !== "POST") return refuse(405, "method");
    if (!ctx.staff) return refuse(503, "staffClosed");
    if (!ctx.store) return refuse(503, "notSetUp");
    const address = addressOf(request);
    /* A throttled caller is told so whatever they typed, or the answer would say which password was right. */
    if ((await ctx.store.failuresSince(address, new Date(now().getTime() - FAILURE_WINDOW_MS))) >= MAX_FAILURES) return refuse(429, "tooMany");
    const body = await bodyOf(request);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!password) return refuse(400, "passwordNeeded");
    if (!passwordMatches(password, ctx.staff)) {
      await ctx.store.noteFailure(address, now());
      return refuse(401, "wrongPassword");
    }
    await ctx.store.clearFailures(address);
    return json(204, null, { "set-cookie": sessionCookie(makeSession(ctx.staff, now()), secure) });
  }

  if (second !== "shipments" && second !== "summary" && second !== "export" && second !== "ai") return refuse(404, "noRoute");
  if (!ctx.staff) return refuse(503, "staffClosed");
  if (!ctx.store) return refuse(503, "notSetUp");
  if (!signedIn) return refuse(401, "signedOut");
  const store = ctx.store;
  const q = (url.searchParams.get("q") ?? "").slice(0, 80);
  const groupParam = url.searchParams.get("group");
  const group = isStatusGroup(groupParam) ? groupParam : null;

  if (second === "summary" && parts.length === 2) {
    if (method !== "GET") return refuse(405, "method");
    return json(200, await store.summary(now()));
  }

  if (second === "export" && parts.length === 2) {
    if (method !== "GET") return refuse(405, "method");
    const lang = url.searchParams.get("lang") === "ar" ? "ar" : "en";
    const csv = shipmentsCsv(await store.exportRows({ q, group }), lang);
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="shiplee-shipments-${kuwaitDay(now())}.csv"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (second === "ai") {
    if (third !== "intake" || parts.length !== 3) return refuse(404, "noRoute");
    if (method !== "POST") return refuse(405, "method");
    if (!sameSiteJson(request)) return refuse(403, "notJson");
    if (!ctx.ai) return refuse(503, "ai.off");
    const body = await bodyOf(request);
    if (!body) return refuse(400, "badBody");
    const outcome = await readOrderMessage(body, { ai: ctx.ai, store, address: addressOf(request), now: now(), seams: ctx.aiSeams });
    return outcome.ok ? json(200, outcome.value) : refuse(outcome.status, outcome.error);
  }

  if (parts.length === 2) {
    if (method === "GET") {
      const page = Number(url.searchParams.get("page") ?? "1");
      return json(200, await store.list({ q, page: Number.isInteger(page) && page > 0 ? page : 1, group }));
    }
    if (method !== "POST") return refuse(405, "method");
    if (!sameSiteJson(request)) return refuse(403, "notJson");
    const body = await bodyOf(request);
    if (!body) return refuse(400, "badBody");
    const { details, problems } = shipmentProblems(body);
    if (!details) return json(422, { error: "problems", problems });
    const digit = ctx.randomDigit ?? (() => randomInt(10));
    /* A billion numbers make a clash rare; five draws make it never matter. */
    for (let tries = 0; tries < 5; tries++) {
      try {
        return json(201, await store.create(details, makeTrackingNumber(digit), now()));
      } catch (error) {
        if (!(error instanceof DuplicateNumber)) throw error;
      }
    }
    return refuse(500, "server");
  }

  const id = Number(third);
  if (!/^\d{1,15}$/.test(third ?? "") || !Number.isSafeInteger(id)) return refuse(404, "gone");

  if (parts.length === 3) {
    if (method === "GET") {
      const shipment = await store.byId(id);
      return shipment ? json(200, shipment) : refuse(404, "gone");
    }
    if (method !== "PATCH") return refuse(405, "method");
    if (!sameSiteJson(request)) return refuse(403, "notJson");
    const body = await bodyOf(request);
    if (!body) return refuse(400, "badBody");
    const { details, problems } = shipmentProblems(body);
    if (!details) return json(422, { error: "problems", problems });
    const shipment = await store.update(id, details);
    return shipment ? json(200, shipment) : refuse(404, "gone");
  }

  if (parts.length === 4 && fourth === "events") {
    if (method !== "POST") return refuse(405, "method");
    if (!sameSiteJson(request)) return refuse(403, "notJson");
    const body = await bodyOf(request);
    if (!body) return refuse(400, "badBody");
    const { update, problems } = updateProblems(body, now());
    if (!update) return json(422, { error: "problems", problems });
    const { expectedOn, ...event } = update;
    const shipment = await store.addEvent(id, event, "expectedOn" in body ? expectedOn : undefined);
    return shipment ? json(201, shipment) : refuse(404, "gone");
  }

  return refuse(404, "noRoute");
}
