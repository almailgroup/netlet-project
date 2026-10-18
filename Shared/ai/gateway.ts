/**
 * The contract between NetLet and its AI gateway — the Cloudflare Worker in
 * `Backend/gateway/` that holds the Gemini key and is the only thing that
 * talks to Gemini.
 *
 * Pure, and imported by all three parties: the Worker validates requests and
 * verifies tokens with it, NetLet's server signs tokens with it, and the
 * browser's hooks check what they send and read the stream with it. One copy,
 * for the password floor's reason: the page cannot send what the gateway
 * would refuse.
 *
 * **A browser reaches the gateway only with a token NetLet's server signed.**
 * CORS is not authentication — it stops another site's page reading the
 * answer, and does nothing about a script that sets its own `Origin` — so a
 * gateway guarded by CORS alone is a Gemini key anybody can spend. The server
 * already knows who is asking and what they may do (`can()`, the `ai`
 * switch); it says so in a short-lived token signed with a secret it shares
 * with the Worker, and the Worker checks the signature, the expiry and the
 * scope before anything reaches the model. HMAC through Web Crypto, which all
 * three runtimes carry, and `crypto.subtle.verify`, which compares in
 * constant time.
 *
 * **NetLet's server uses the same door for its own model calls** — search
 * refinement, the "Picked for you" order, photo search, support drafts, the
 * review queue's pass and the Arabic name — with a `server` token it signs for
 * itself and never hands out (`POST /api/ai/generate`). So the Gemini key is
 * in one place, the Worker, and there is one provider and one bill.
 */
import type { ProductBrief } from "../commerce/assistant.js";

/** The model every route uses unless the Worker's `GEMINI_MODEL` says otherwise. */
export const GATEWAY_MODEL = "gemini-2.5-flash";

/**
 * What a token lets its holder do: talk to the shop's assistant, draft a
 * product, or — NetLet's server only — ask for one answer of its own.
 */
export const GATEWAY_SCOPES = ["chat", "catalog", "server"] as const;
export type GatewayScope = (typeof GATEWAY_SCOPES)[number];

export const GATEWAY_LOCALES = ["en", "ar"] as const;
export type GatewayLocale = (typeof GATEWAY_LOCALES)[number];

/** The routes, as the Worker serves them. */
export const GATEWAY_ROUTES = { chat: "/api/ai/chat", catalog: "/api/ai/catalog-assist", server: "/api/ai/generate" } as const;

/**
 * What NetLet's server asks the model for, one name per feature. A `server`
 * token's subject is `s:<task>`, so the Worker's ceiling and its log count
 * each feature apart, and a runaway loop in one cannot starve the others.
 */
export const SERVER_TASKS = ["searchRefine", "recommendOrder", "photoSearch", "supportDraft", "reviewConcern", "arabicName"] as const;
export type ServerTask = (typeof SERVER_TASKS)[number];

/**
 * Five minutes. Short, because a token is a bearer credential handed to a
 * browser and the `ai` switch is read when it is minted: turning model calls
 * off reaches every open page within one lifetime. The hooks mint another on
 * expiry without the shopper noticing.
 */
export const TOKEN_TTL_SECONDS = 300;
/** A clock between NetLet's server and Cloudflare's may disagree by this much. */
export const TOKEN_SKEW_SECONDS = 30;
/** Shorter than this, the shared secret is guessable rather than secret. */
export const MIN_SECRET_LENGTH = 32;
/** Longer than any token NetLet signs; anything bigger is refused unread. */
const MAX_TOKEN_LENGTH = 1024;

export type GatewayClaims = {
  v: 1;
  scope: GatewayScope;
  /**
   * Who the limits count against: `u:<account id>` signed in, `a:<digest>`
   * signed out, the digest being the server's keyed hash of the address so a
   * guest cannot reset their own ceiling by asking for a new token — and
   * `s:<task>` for NetLet's server, which only a `server` token carries.
   */
  sub: string;
  /** For `catalog`: the store the draft is for, or null for an administrator. */
  vendor: number | null;
  /** Expiry, in seconds since the epoch. */
  exp: number;
};

/* ------------------------------------------------------------------------ */
/* Tokens                                                                    */
/* ------------------------------------------------------------------------ */

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** The token NetLet's server hands a browser: `v1.<claims>.<signature>`. */
export async function signGatewayToken(claims: GatewayClaims, secret: string): Promise<string> {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("AI gateway secret is too short");
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(`v1.${payload}`));
  return `v1.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

function isClaims(value: unknown): value is GatewayClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Record<string, unknown>;
  return claims.v === 1
    && GATEWAY_SCOPES.includes(claims.scope as GatewayScope)
    && typeof claims.sub === "string" && /^[uas]:[A-Za-z0-9_-]{1,64}$/.test(claims.sub)
    /* A server subject only on a server token, and a server token only for a task. */
    && (claims.scope === "server") === claims.sub.startsWith("s:")
    && (claims.scope !== "server" || SERVER_TASKS.includes(claims.sub.slice(2) as ServerTask))
    && (claims.vendor === null || (Number.isInteger(claims.vendor) && (claims.vendor as number) > 0))
    && Number.isInteger(claims.exp);
}

/**
 * The claims, or null for anything that is not a live token NetLet signed:
 * a bad signature, a wrong secret, an expired one, and one that lives longer
 * than a token is ever minted for — which only a server bug or a leaked
 * secret produces, and neither should be honoured.
 */
export async function verifyGatewayToken(token: string, secret: string, nowSeconds: number): Promise<GatewayClaims | null> {
  if (secret.length < MIN_SECRET_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  const [version, payload, signed, ...rest] = token.split(".");
  if (version !== "v1" || payload === undefined || signed === undefined || rest.length) return null;
  const signature = fromBase64Url(signed);
  const body = fromBase64Url(payload);
  if (!signature || !body) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), signature, encoder.encode(`v1.${payload}`));
  if (!valid) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  if (claims.exp <= nowSeconds - TOKEN_SKEW_SECONDS) return null;
  if (claims.exp > nowSeconds + TOKEN_TTL_SECONDS + TOKEN_SKEW_SECONDS) return null;
  return claims;
}

/* ------------------------------------------------------------------------ */
/* Answers and refusals                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Every refusal the gateway gives, by name. The page turns a code into a
 * sentence in its own language; the `message` beside it is for a log.
 */
export const GATEWAY_ERRORS = [
  "unauthorised",
  "forbidden_origin",
  "wrong_scope",
  "bad_request",
  "contact_details",
  "too_large",
  "rate_limited",
  "not_found",
  "method_not_allowed",
  "model_unavailable",
  "model_refused",
  "not_configured",
] as const;
export type GatewayErrorCode = (typeof GATEWAY_ERRORS)[number];

export type GatewayError = { ok: false; error: { code: GatewayErrorCode; message: string; field?: string } };
export type GatewayOk<T> = { ok: true; data: T };
export type GatewayResponse<T> = GatewayOk<T> | GatewayError;

/** The HTTP status each refusal travels with. */
export const GATEWAY_STATUS: Record<GatewayErrorCode, number> = {
  unauthorised: 401,
  forbidden_origin: 403,
  wrong_scope: 403,
  bad_request: 400,
  contact_details: 400,
  too_large: 413,
  rate_limited: 429,
  not_found: 404,
  method_not_allowed: 405,
  model_unavailable: 502,
  model_refused: 422,
  not_configured: 503,
};

/* ------------------------------------------------------------------------ */
/* POST /api/ai/chat                                                         */
/* ------------------------------------------------------------------------ */

/** How much of a conversation travels with each question. */
export const MAX_CHAT_TURNS = 12;
/** The longest single turn, either side. */
export const MAX_CHAT_TEXT = 1000;
/** The largest chat body the gateway reads. */
export const MAX_CHAT_BODY_BYTES = 64 * 1024;

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type ChatRequest = {
  locale: GatewayLocale;
  /** Oldest first, ending on the shopper's question. */
  messages: ChatTurn[];
  /**
   * The product the shopper is looking at, when they are on one — the same
   * public listing the product assistant is given (`briefFor`), so the chat
   * can answer "does this one come in black" from the page rather than from
   * the model's idea of the category. Data, fenced, never instructions.
   */
  product?: ProductBrief | null;
};

/**
 * What the chat streams back, one per Server-Sent Event `data:` line. `done`
 * says why it stopped: the answer ended, it hit the length ceiling, or the
 * model's own safety filter stopped it part-way.
 */
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "done"; finish: "stop" | "length" | "blocked" }
  | { type: "error"; code: GatewayErrorCode };

export type Checked<T> = { ok: true; value: T } | { ok: false; field: string; message: string };

const fail = (field: string, message: string): { ok: false; field: string; message: string } => ({ ok: false, field, message });

function isLocale(value: unknown): value is GatewayLocale {
  return GATEWAY_LOCALES.includes(value as GatewayLocale);
}

function shortText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

function checkBrief(value: unknown): Checked<ProductBrief | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "object") return fail("product", "must be an object");
  const brief = value as Record<string, unknown>;
  if (!shortText(brief.title, 200) || !brief.title.trim()) return fail("product.title", "1 to 200 characters");
  if (brief.category !== null && !shortText(brief.category, 120)) return fail("product.category", "text or null");
  if (brief.vendor !== null && !shortText(brief.vendor, 120)) return fail("product.vendor", "text or null");
  if (!shortText(brief.description, 1500)) return fail("product.description", "at most 1500 characters");
  if (!Array.isArray(brief.specs) || brief.specs.length > 24 || !brief.specs.every(row => shortText(row, 240))) {
    return fail("product.specs", "at most 24 rows of 240 characters");
  }
  return {
    ok: true,
    value: {
      title: brief.title,
      category: (brief.category as string | null) ?? null,
      vendor: (brief.vendor as string | null) ?? null,
      description: brief.description,
      specs: brief.specs as string[],
    },
  };
}

/** A chat body as the gateway will accept it, or the first thing wrong with it. */
export function checkChatRequest(body: unknown): Checked<ChatRequest> {
  if (!body || typeof body !== "object") return fail("body", "must be a JSON object");
  const request = body as Record<string, unknown>;
  if (!isLocale(request.locale)) return fail("locale", "en or ar");
  const messages = request.messages;
  if (!Array.isArray(messages) || messages.length === 0) return fail("messages", "at least one turn");
  if (messages.length > MAX_CHAT_TURNS) return fail("messages", `at most ${MAX_CHAT_TURNS} turns`);
  for (const [index, turn] of messages.entries()) {
    if (!turn || typeof turn !== "object") return fail(`messages.${index}`, "must be an object");
    const { role, text } = turn as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") return fail(`messages.${index}.role`, "user or assistant");
    if (!shortText(text, MAX_CHAT_TEXT) || !text.trim()) return fail(`messages.${index}.text`, `1 to ${MAX_CHAT_TEXT} characters`);
  }
  if ((messages[messages.length - 1] as ChatTurn).role !== "user") return fail("messages", "must end on the shopper's question");
  const product = checkBrief(request.product);
  if (!product.ok) return product;
  return {
    ok: true,
    value: {
      locale: request.locale,
      messages: (messages as ChatTurn[]).map(turn => ({ role: turn.role, text: turn.text })),
      product: product.value,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* POST /api/ai/catalog-assist                                               */
/* ------------------------------------------------------------------------ */

/** The seller's own notes: what they would type into a message to a copywriter. */
export const MAX_NOTES = 4000;
export const MAX_IMAGES = 3;
/**
 * About a megabyte of picture once decoded. `preparePhoto` already shrinks a
 * photo to 768px on its long side, which lands far under this.
 */
export const MAX_IMAGE_BASE64 = 1_400_000;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const MAX_CATALOG_BODY_BYTES = MAX_IMAGES * MAX_IMAGE_BASE64 + 64 * 1024;

export type CatalogImage = { mimeType: ImageType; data: string };

export type CatalogAssistRequest = {
  locale: GatewayLocale;
  notes: string;
  /** The department the seller already chose, by slug; the model is held to it. */
  department?: string | null;
  images?: CatalogImage[];
};

/**
 * A draft for the seller to read, change and keep — never saved by itself,
 * the "Draft with AI" rule for the Arabic name. Both languages, because a
 * listing needs its Arabic name and the shop is read in both.
 */
export type CatalogDraft = {
  title: { en: string; ar: string };
  /**
   * Paragraphs, and lines starting "- " for a list: the subset of Markdown
   * NetLet's product page draws (`descriptionBlocks`). A heading or `**bold**`
   * would show as the characters themselves.
   */
  description: { en: string; ar: string };
  /** A NetLet department slug, or null when none fits. */
  department: string | null;
  tags: string[];
  /** Specification rows, keyed by the department's own fields (`fieldsFor`). */
  attributes: { key: string; value: string }[];
  /** The department's fields the notes and photos did not answer. */
  missing: string[];
  /**
   * What a search engine would show. NetLet stores no separate search title
   * yet — the preview is `productMeta`'s rule over the name and description —
   * so these are offered, and keeping them needs a column first.
   */
  seo: { title: string; description: string };
};

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A catalogue body as the gateway will accept it, or the first thing wrong with it. */
export function checkCatalogRequest(body: unknown, departments: readonly string[]): Checked<CatalogAssistRequest> {
  if (!body || typeof body !== "object") return fail("body", "must be a JSON object");
  const request = body as Record<string, unknown>;
  if (!isLocale(request.locale)) return fail("locale", "en or ar");
  const notes = request.notes ?? "";
  if (!shortText(notes, MAX_NOTES)) return fail("notes", `at most ${MAX_NOTES} characters`);
  const department = request.department ?? null;
  if (department !== null && !departments.includes(department as string)) return fail("department", "a NetLet department slug or null");
  const images = request.images ?? [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES) return fail("images", `at most ${MAX_IMAGES}`);
  for (const [index, image] of images.entries()) {
    if (!image || typeof image !== "object") return fail(`images.${index}`, "must be an object");
    const { mimeType, data } = image as Record<string, unknown>;
    if (!IMAGE_TYPES.includes(mimeType as ImageType)) return fail(`images.${index}.mimeType`, IMAGE_TYPES.join(", "));
    if (typeof data !== "string" || !data || data.length > MAX_IMAGE_BASE64 || !BASE64.test(data)) {
      return fail(`images.${index}.data`, "base64, at most about 1 MB");
    }
  }
  if (!notes.trim() && images.length === 0) return fail("notes", "notes or at least one photo");
  return {
    ok: true,
    value: {
      locale: request.locale,
      notes,
      department: department as string | null,
      images: (images as CatalogImage[]).map(image => ({ mimeType: image.mimeType, data: image.data })),
    },
  };
}

/* ------------------------------------------------------------------------ */
/* POST /api/ai/generate — NetLet's server only                              */
/* ------------------------------------------------------------------------ */

export const MAX_GENERATE_SYSTEM = 4000;
export const MAX_GENERATE_PROMPT = 16_000;
export const MAX_GENERATE_OUTPUT = 1024;
/** Each feature keeps its own deadline under this; a call is never held longer. */
export const MAX_GENERATE_MS = 20_000;
export const MAX_GENERATE_BODY_BYTES = MAX_IMAGE_BASE64 + 64 * 1024;

/**
 * One answer for one of NetLet's own features. The prompt is built on the
 * server from the feature's own rules — what it may send, how a shopper's or
 * a seller's words are fenced — so the Worker carries no copy of them; it
 * checks the shape and the sizes and passes the call on.
 */
export type GenerateRequest = {
  system: string;
  prompt: string;
  /** A photo, for photo search: base64 without the `data:` prefix. */
  image?: CatalogImage | null;
  /** Asks for a JSON object back, which the server parses and holds to its own rules. */
  json: boolean;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
};

/** What comes back: the model's text, which the feature reads with its own rules. */
export type GenerateAnswer = { text: string };

/** A generate body as the gateway will accept it, or the first thing wrong with it. */
export function checkGenerateRequest(body: unknown): Checked<GenerateRequest> {
  if (!body || typeof body !== "object") return fail("body", "must be a JSON object");
  const request = body as Record<string, unknown>;
  if (!shortText(request.system, MAX_GENERATE_SYSTEM) || !request.system.trim()) return fail("system", `1 to ${MAX_GENERATE_SYSTEM} characters`);
  if (!shortText(request.prompt, MAX_GENERATE_PROMPT)) return fail("prompt", `at most ${MAX_GENERATE_PROMPT} characters`);
  const image = request.image ?? null;
  if (image !== null) {
    if (typeof image !== "object") return fail("image", "must be an object or null");
    const { mimeType, data } = image as Record<string, unknown>;
    if (!IMAGE_TYPES.includes(mimeType as ImageType)) return fail("image.mimeType", IMAGE_TYPES.join(", "));
    if (typeof data !== "string" || !data || data.length > MAX_IMAGE_BASE64 || !BASE64.test(data)) return fail("image.data", "base64, at most about 1 MB");
  }
  if (!request.prompt.trim() && image === null) return fail("prompt", "a prompt or a photo");
  if (typeof request.json !== "boolean") return fail("json", "true or false");
  const { temperature, maxOutputTokens, timeoutMs } = request;
  if (typeof temperature !== "number" || !(temperature >= 0 && temperature <= 1)) return fail("temperature", "0 to 1");
  if (!Number.isInteger(maxOutputTokens) || (maxOutputTokens as number) < 1 || (maxOutputTokens as number) > MAX_GENERATE_OUTPUT) {
    return fail("maxOutputTokens", `1 to ${MAX_GENERATE_OUTPUT}`);
  }
  if (!Number.isInteger(timeoutMs) || (timeoutMs as number) < 500 || (timeoutMs as number) > MAX_GENERATE_MS) return fail("timeoutMs", `500 to ${MAX_GENERATE_MS}`);
  return {
    ok: true,
    value: {
      system: request.system,
      prompt: request.prompt,
      image: image ? { mimeType: (image as CatalogImage).mimeType, data: (image as CatalogImage).data } : null,
      json: request.json,
      temperature,
      maxOutputTokens: maxOutputTokens as number,
      timeoutMs: timeoutMs as number,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Server-Sent Events                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Reads `data:` payloads out of an event stream as it arrives, a chunk at a
 * time, holding back a half-received event until the rest comes. One reader
 * for both hops — Gemini to the Worker, the Worker to the browser — because
 * a chunk boundary can fall anywhere, mid-line included, and two parsers are
 * two chances to get that wrong.
 */
export function createSseReader(onData: (data: string) => void): { push(chunk: string): void; end(): void } {
  let buffer = "";
  const flush = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) onData(data);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
        flush(block);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    },
    end() {
      if (buffer.trim()) flush(buffer);
      buffer = "";
    },
  };
}

/** One event, as the Worker writes it. */
export function sseEvent(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** One event, as the browser reads it; anything else is ignored rather than thrown. */
export function parseChatEvent(data: string): ChatEvent | null {
  try {
    const event = JSON.parse(data) as ChatEvent;
    if (event?.type === "delta" && typeof event.text === "string") return event;
    if (event?.type === "done" && ["stop", "length", "blocked"].includes(event.finish)) return event;
    if (event?.type === "error" && GATEWAY_ERRORS.includes(event.code)) return event;
    return null;
  } catch {
    return null;
  }
}
