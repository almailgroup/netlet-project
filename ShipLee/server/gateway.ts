/**
 * ShipLee AI's line to Gemini, on the owner's word ("implement the AI that we
 * have, Gemini, named ShipLee AI, from the Cloudflare Worker").
 *
 * The Gemini key lives in one place, NetLet's Cloudflare Worker
 * (`Backend/gateway` in this repository), and ShipLee asks it through a door
 * of its own, `POST /api/shiplee/generate`, with a token this server signs for
 * each call. ShipLee imports nothing from NetLet, so the token is written here
 * again, in the Worker's format: `v1.<claims>.<signature>`, the claims
 * `{ v: 1, app: "shiplee", task, exp }` as base64url JSON and the signature an
 * HMAC-SHA-256 of `v1.<claims>` with `SHIPLEE_AI_SECRET` — the same value the
 * Worker holds as `SHIPLEE_GATEWAY_SECRET`, and never NetLet's own secret.
 * `gateway.test.ts` checks a fixed token, and the Worker's test checks the same
 * one, so the two cannot drift.
 *
 *   SHIPLEE_AI_URL     the Worker's address, e.g. https://netlet-ai-gateway.<account>.workers.dev
 *   SHIPLEE_AI_SECRET  32 or more random characters
 *
 * Unset, ShipLee AI is not drawn anywhere: `/api/config` says `ai: false`.
 */
import { createHmac } from "node:crypto";

export type ShipLeeAI = { url: string; secret: string };

export const AI_TASKS = ["assistant", "intake"] as const;
export type AiTask = (typeof AI_TASKS)[number];

/** Shorter than this, a shared secret is guessable rather than secret (the Worker's own floor). */
export const MIN_AI_SECRET = 32;
/** A token is signed for one call; a minute covers the call and a clock a little out. */
const TOKEN_SECONDS = 60;
/** The route on the Worker. */
export const AI_ROUTE = "/api/shiplee/generate";

export function aiFromEnv(env: Record<string, string | undefined>): ShipLeeAI | null {
  const secret = env.SHIPLEE_AI_SECRET ?? "";
  if (secret.length < MIN_AI_SECRET) return null;
  let url: URL;
  try {
    url = new URL((env.SHIPLEE_AI_URL ?? "").trim());
  } catch {
    return null;
  }
  /* The Worker's own address and nothing else: https, or plain http on this machine for `wrangler dev`. */
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, "") !== "") return null;
  return { url: url.origin, secret };
}

export function signAiToken(task: AiTask, secret: string, nowMs: number): string {
  /* Written in this order, always: the Worker reads the JSON, and the test vector reads the bytes. */
  const claims = { v: 1, app: "shiplee", task, exp: Math.floor(nowMs / 1000) + TOKEN_SECONDS };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`v1.${payload}`).digest("base64url");
  return `v1.${payload}.${signature}`;
}

export type ModelCall = {
  task: AiTask;
  system: string;
  prompt: string;
  /** A JSON object back, which the caller holds to its own rules. */
  json: boolean;
  temperature: number;
  maxOutputTokens: number;
  /** The model's deadline; the request gives up a little after it. Under Vercel's 15 seconds. */
  timeoutMs: number;
};

export type Seams = { fetcher?: typeof fetch; now?: () => number };

/**
 * The model's text, or null for every way it did not come — the Worker
 * refusing, Gemini failing, a timeout, an answer of the wrong shape. Each
 * caller has a sentence for null, so nothing here throws, and nothing about
 * the question is logged: it can hold a recipient's details.
 */
export async function askModel(ai: ShipLeeAI, call: ModelCall, seams: Seams = {}): Promise<string | null> {
  const fetcher = seams.fetcher ?? fetch;
  const now = seams.now ?? Date.now;
  let response: Response;
  try {
    response = await fetcher(`${ai.url}${AI_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${signAiToken(call.task, ai.secret, now())}` },
      body: JSON.stringify({
        system: call.system,
        prompt: call.prompt,
        json: call.json,
        temperature: call.temperature,
        maxOutputTokens: call.maxOutputTokens,
        timeoutMs: call.timeoutMs,
      }),
      signal: AbortSignal.timeout(call.timeoutMs + 1500),
    });
  } catch (error) {
    console.warn("[shiplee] ShipLee AI could not be reached:", call.task, error instanceof Error ? error.name : "error");
    return null;
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const answer = body as { ok?: boolean; data?: { text?: unknown }; error?: { code?: unknown } } | null;
  if (!response.ok || !answer?.ok || typeof answer.data?.text !== "string") {
    console.warn("[shiplee] ShipLee AI did not answer:", call.task, response.status, typeof answer?.error?.code === "string" ? answer.error.code : "");
    return null;
  }
  return answer.data.text;
}
