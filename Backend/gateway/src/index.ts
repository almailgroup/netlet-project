/**
 * NetLet's AI gateway: a Cloudflare Worker that holds the Gemini key and is
 * the only thing that talks to Gemini.
 *
 *   GET  / or /healthz            whether it is configured, and which model
 *   POST /api/ai/chat             the shop's assistant, streamed as Server-Sent Events
 *   POST /api/ai/catalog-assist   a product listing drafted from notes and photos, as JSON
 *   POST /api/ai/generate         one answer for NetLet's own server — search refinement, the
 *                                 "Picked for you" order, photo search, support drafts, the
 *                                 review queue's pass, the Arabic name — with a token only the
 *                                 server signs and never hands out
 *
 * Every POST passes the same gates, in order, each answered with a code from
 * `GATEWAY_ERRORS` and its own status, never Google's text:
 *
 * 1. **Origin.** A browser request from a page not on `ALLOWED_ORIGINS` is
 *    refused, and only listed origins get CORS headers. A request with no
 *    `Origin` — NetLet's own server, `curl` — goes on to the token, which is
 *    the gate that actually decides.
 * 2. **Token.** `Authorization: Bearer <token>`, signed by NetLet's server
 *    with `AI_GATEWAY_SECRET` (`Shared/ai/gateway.ts`), live, and for this
 *    route's scope — a shopper's chat token cannot draft products.
 * 3. **Ceilings.** Per caller (`sub`) per route, and per network address
 *    across both, through Cloudflare's rate-limiting bindings — so a guest
 *    asking for a fresh token does not get a fresh allowance. NetLet's server
 *    is counted per feature and never by address: every call it makes comes
 *    from the same few Vercel addresses, and each feature keeps its own
 *    per-shopper ceiling in Postgres before it calls.
 * 4. **The body.** Size first, unread, then shape (`checkChatRequest`,
 *    `checkCatalogRequest`), then a shopper's question carrying a phone
 *    number, an email or a link is refused before it reaches a third party —
 *    the help assistant's rule, by the chat's own filter.
 */
import {
  GATEWAY_IMAGE_MODEL,
  GATEWAY_MODEL,
  IMAGE_TYPES,
  GATEWAY_ROUTES,
  GATEWAY_STATUS,
  MAX_CATALOG_BODY_BYTES,
  MAX_CHAT_BODY_BYTES,
  MAX_GENERATE_BODY_BYTES,
  checkCatalogRequest,
  checkChatRequest,
  checkGenerateRequest,
  sseEvent,
  verifyGatewayToken,
  type GatewayClaims,
  type GatewayErrorCode,
  type GatewayScope,
} from "../../../Shared/ai/gateway.js";
import { CATALOG_RESPONSE_SCHEMA, DEPARTMENT_SLUGS, draftFromModel } from "../../../Shared/ai/catalogDraft.js";
import { contactFindings } from "../../../Shared/commerce/contactFilter.js";
import { GeminiFailure, generateJson, generateParts, streamText, type GeminiPart, type StreamPiece } from "./gemini.js";
import { catalogContents, catalogSystem, chatContents, chatSystem } from "./prompts.js";

/** Cloudflare's rate-limiting binding, as much of it as this uses. */
export type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export interface Env {
  /** Secret: the Gemini API key. `wrangler secret put GEMINI_API_KEY`. */
  GEMINI_API_KEY?: string;
  /** Secret: shared with NetLet's server, which signs the tokens. `wrangler secret put AI_GATEWAY_SECRET`. */
  AI_GATEWAY_SECRET?: string;
  /** The pages allowed to call from a browser, comma-separated, scheme and host exactly. */
  ALLOWED_ORIGINS?: string;
  /** Defaults to `GATEWAY_MODEL`. */
  GEMINI_MODEL?: string;
  /** The drawing model; defaults to `GATEWAY_IMAGE_MODEL`. */
  GEMINI_IMAGE_MODEL?: string;
  CHAT_LIMITER?: RateLimiter;
  CATALOG_LIMITER?: RateLimiter;
  ADDRESS_LIMITER?: RateLimiter;
  /** NetLet's server, per feature. */
  SERVER_LIMITER?: RateLimiter;
}

/** What the tests replace: the network and the clock. */
export type Seams = { fetcher?: typeof fetch; now?: () => number };

const ROUTE_SCOPE: Record<string, GatewayScope> = {
  [GATEWAY_ROUTES.chat]: "chat",
  [GATEWAY_ROUTES.catalog]: "catalog",
  [GATEWAY_ROUTES.server]: "server",
};

const BODY_LIMIT: Record<GatewayScope, number> = {
  chat: MAX_CHAT_BODY_BYTES,
  catalog: MAX_CATALOG_BODY_BYTES,
  server: MAX_GENERATE_BODY_BYTES,
};

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "").split(",").map(origin => origin.trim().replace(/\/+$/, "")).filter(Boolean);
}

function baseHeaders(origin: string | null, allowed: boolean): Headers {
  const headers = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff", vary: "Origin" });
  if (origin && allowed) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-expose-headers", "retry-after");
  }
  return headers;
}

function json(status: number, body: unknown, headers: Headers): Response {
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function refuse(code: GatewayErrorCode, message: string, headers: Headers, field?: string): Response {
  if (code === "rate_limited") headers.set("retry-after", "60");
  return json(GATEWAY_STATUS[code], { ok: false, error: { code, message, ...(field ? { field } : {}) } }, headers);
}

/** The body, if it is JSON and no larger than the route allows. */
async function readJson(request: Request, limit: number): Promise<{ ok: true; body: unknown } | { ok: false; code: GatewayErrorCode; message: string }> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { ok: false, code: "bad_request", message: "Content-Type must be application/json" };
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return { ok: false, code: "too_large", message: `At most ${limit} bytes` };
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > limit) return { ok: false, code: "too_large", message: `At most ${limit} bytes` };
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, code: "bad_request", message: "The body is not JSON" };
  }
}

async function underCeiling(env: Env, scope: GatewayScope, claims: GatewayClaims, address: string): Promise<boolean> {
  const perCaller = scope === "chat" ? env.CHAT_LIMITER : scope === "catalog" ? env.CATALOG_LIMITER : env.SERVER_LIMITER;
  const counted = scope !== "server" && env.ADDRESS_LIMITER && address;
  const [caller, network] = await Promise.all([
    perCaller ? perCaller.limit({ key: `${scope}:${claims.sub}` }) : { success: true },
    counted ? env.ADDRESS_LIMITER!.limit({ key: address }) : { success: true },
  ]);
  return caller.success && network.success;
}

function failureCode(error: unknown): GatewayErrorCode {
  return error instanceof GeminiFailure && error.reason === "blocked" ? "model_refused" : "model_unavailable";
}

const encoder = new TextEncoder();

async function chat(body: unknown, env: Env, headers: Headers, seams: Seams): Promise<Response> {
  const checked = checkChatRequest(body);
  if (!checked.ok) return refuse("bad_request", checked.message, headers, checked.field);
  const request = checked.value;
  const carrying = request.messages.find(turn => turn.role === "user" && contactFindings(turn.text).length);
  if (carrying) return refuse("contact_details", contactFindings(carrying.text).join(", "), headers);

  let pieces: AsyncGenerator<StreamPiece>;
  try {
    pieces = await streamText({
      apiKey: env.GEMINI_API_KEY!,
      model: env.GEMINI_MODEL || GATEWAY_MODEL,
      system: chatSystem(request.locale),
      contents: chatContents(request),
      temperature: 0.3,
      maxOutputTokens: 700,
      timeoutMs: 20_000,
      fetcher: seams.fetcher,
    });
  } catch (error) {
    console.warn("gateway chat", error instanceof GeminiFailure ? error.reason : "error", String(error));
    return refuse(failureCode(error), "The model could not answer", headers);
  }

  /* Pulled rather than pushed, so a browser that reads slowly holds Gemini
     back instead of filling the Worker's memory, and a browser that goes away
     cancels the generator — which cancels Gemini's own stream. */
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await pieces.next();
        if (done) {
          controller.close();
          return;
        }
        if (value.kind === "text") controller.enqueue(encoder.encode(sseEvent({ type: "delta", text: value.text })));
        else {
          controller.enqueue(encoder.encode(sseEvent({ type: "done", finish: value.finish })));
          controller.close();
        }
      } catch (error) {
        console.warn("gateway chat stream", String(error));
        controller.enqueue(encoder.encode(sseEvent({ type: "error", code: "model_unavailable" })));
        controller.close();
      }
    },
    async cancel() {
      await pieces.return(undefined);
    },
  });
  headers.set("content-type", "text/event-stream; charset=utf-8");
  return new Response(stream, { status: 200, headers });
}

async function catalog(body: unknown, env: Env, headers: Headers, seams: Seams): Promise<Response> {
  const checked = checkCatalogRequest(body, DEPARTMENT_SLUGS);
  if (!checked.ok) return refuse("bad_request", checked.message, headers, checked.field);
  const request = checked.value;
  try {
    const answer = await generateJson({
      apiKey: env.GEMINI_API_KEY!,
      model: env.GEMINI_MODEL || GATEWAY_MODEL,
      system: catalogSystem(request.locale),
      contents: catalogContents(request),
      temperature: 0.4,
      maxOutputTokens: 2048,
      schema: CATALOG_RESPONSE_SCHEMA,
      timeoutMs: 25_000,
      fetcher: seams.fetcher,
    });
    const draft = draftFromModel(answer, request);
    if (!draft) return refuse("model_unavailable", "The model's draft had nothing usable in it", headers);
    return json(200, { ok: true, data: draft }, headers);
  } catch (error) {
    console.warn("gateway catalog", error instanceof GeminiFailure ? error.reason : "error", String(error));
    return refuse(failureCode(error), "The model could not draft this product", headers);
  }
}

/**
 * One answer for NetLet's server. The prompt arrives built — the feature's
 * own rules decided what went into it on the server — so this checks sizes
 * and shape, asks once, and hands back the text for the feature to read.
 */
async function generate(body: unknown, claims: GatewayClaims, env: Env, headers: Headers, seams: Seams): Promise<Response> {
  const checked = checkGenerateRequest(body);
  if (!checked.ok) return refuse("bad_request", checked.message, headers, checked.field);
  const request = checked.value;
  const parts: GeminiPart[] = [];
  for (const image of [request.image, ...(request.images ?? [])]) {
    if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }
  if (request.prompt.trim()) parts.push({ text: request.prompt });
  const draw = request.output === "image";
  try {
    const answer = await generateParts({
      apiKey: env.GEMINI_API_KEY!,
      model: draw ? env.GEMINI_IMAGE_MODEL || GATEWAY_IMAGE_MODEL : env.GEMINI_MODEL || GATEWAY_MODEL,
      system: request.system,
      contents: [{ role: "user", parts }],
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      json: request.json,
      search: request.search,
      draw,
      timeoutMs: request.timeoutMs,
      fetcher: seams.fetcher,
    });
    /* A picture only when one was asked for, and sources only for a search:
       an answer carries what its caller can read and nothing else. */
    const image = draw && answer.image && IMAGE_TYPES.includes(answer.image.mimeType as never) ? answer.image : null;
    if (draw && !image) return refuse("model_unavailable", "The model drew nothing usable", headers);
    return json(200, { ok: true, data: { text: answer.text, ...(draw ? { image } : {}), ...(request.search ? { sources: answer.sources } : {}) } }, headers);
  } catch (error) {
    console.warn("gateway generate", claims.sub, error instanceof GeminiFailure ? error.reason : "error", String(error));
    return refuse(failureCode(error), "The model could not answer", headers);
  }
}

export async function handle(request: Request, env: Env, seams: Seams = {}): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const allowed = origin !== null && allowedOrigins(env).includes(origin);
  const headers = baseHeaders(origin, allowed);
  if (origin !== null && !allowed) return refuse("forbidden_origin", "This page may not call the gateway", headers);

  if (request.method === "OPTIONS") {
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "authorization, content-type");
    headers.set("access-control-max-age", "600");
    return new Response(null, { status: 204, headers });
  }

  /* The bare address too: it is what anybody checking the Worker opens first,
     and "No such route" there read as a broken deploy. */
  if (url.pathname === "/healthz" || url.pathname === "/") {
    if (request.method !== "GET") return refuse("method_not_allowed", "GET only", headers);
    const configured = Boolean(env.GEMINI_API_KEY) && (env.AI_GATEWAY_SECRET ?? "").length >= 32;
    return json(200, { ok: true, data: { configured, model: env.GEMINI_MODEL || GATEWAY_MODEL } }, headers);
  }

  const scope = ROUTE_SCOPE[url.pathname];
  if (!scope) return refuse("not_found", "No such route", headers);
  if (request.method !== "POST") return refuse("method_not_allowed", "POST only", headers);
  if (!env.GEMINI_API_KEY || (env.AI_GATEWAY_SECRET ?? "").length < 32) {
    return refuse("not_configured", "GEMINI_API_KEY and AI_GATEWAY_SECRET must both be set", headers);
  }

  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const now = Math.floor((seams.now?.() ?? Date.now()) / 1000);
  const claims = bearer ? await verifyGatewayToken(bearer, env.AI_GATEWAY_SECRET!, now) : null;
  if (!claims) return refuse("unauthorised", "A live token from NetLet is required", headers);
  if (claims.scope !== scope) return refuse("wrong_scope", `This token is for ${claims.scope}`, headers);

  const address = request.headers.get("cf-connecting-ip") ?? "";
  if (!(await underCeiling(env, scope, claims, address))) return refuse("rate_limited", "Too many requests; try again in a minute", headers);

  const body = await readJson(request, BODY_LIMIT[scope]);
  if (!body.ok) return refuse(body.code, body.message, headers);

  if (scope === "chat") return chat(body.body, env, headers, seams);
  if (scope === "catalog") return catalog(body.body, env, headers, seams);
  return generate(body.body, claims, env, headers, seams);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
