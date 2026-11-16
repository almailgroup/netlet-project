/**
 * NetLet's own model calls, through the AI gateway (`Backend/gateway/`).
 *
 * Six features ask a model for something on the server — search refinement,
 * the "Picked for you" order, photo search, support drafts, the review
 * queue's pass and the Arabic name — and each called Mistral with a key of
 * its own on this server. They ask Gemini now, through the same Worker the
 * shop's chat and the product drafter use, so the Gemini key lives in one
 * place and there is one provider and one bill.
 *
 * The feature still builds its own prompt, from its own rules, and still
 * reads the answer with them: this only carries the call. A `server` token is
 * signed for each call and never leaves this process — its subject names the
 * feature (`s:<task>`), which is what the Worker counts and logs — and every
 * failure is one answer, `null`: unconfigured, refused, over the ceiling, a
 * timeout, an answer that is not one. Each feature already has a
 * deterministic answer for that, and that is what the shopper gets.
 */
import { ENV } from "../core/env.js";
import { gatewayConfigured, gatewayOrigin } from "../core/aiGateway.js";
import { featureOn } from "./features.js";
import {
  GATEWAY_ROUTES,
  signGatewayToken,
  type CatalogImage,
  type GatewayCause,
  type GatewayResponse,
  type GenerateAnswer,
  type GenerateRequest,
  type ImageAspect,
  type ServerTask,
} from "../../../Shared/ai/gateway.js";

/** Whether a model can be asked at all: the gateway set up, and model calls not switched off (2.3). */
export async function modelAvailable(): Promise<boolean> {
  return gatewayConfigured() && (await featureOn("ai"));
}

export type ModelCall = {
  system: string;
  prompt: string;
  image?: CatalogImage | null;
  /** More pictures after `image`, in order. */
  images?: CatalogImage[];
  /** A JSON object back, which the feature parses and holds to its own rules. */
  json: boolean;
  /** Ground the answer in a Google search; `sources` are the pages it read. */
  search?: boolean;
  /** A picture back from the drawing model instead of words. */
  output?: "text" | "image";
  /** The drawn picture's shape: a card's photo is square. */
  aspectRatio?: ImageAspect;
  temperature: number;
  maxOutputTokens: number;
  /**
   * How long the feature will wait, the hop to the Worker included. The
   * Worker is given a little less for Gemini, so a slow answer is refused
   * there rather than abandoned here.
   */
  deadlineMs: number;
};

/** A server token lives a minute: it is made for one call and spent at once. */
const SERVER_TOKEN_SECONDS = 60;

/** The whole answer — words, a picture, the pages searched — or null for every way it did not come. */
export async function askModelFor(task: ServerTask, call: ModelCall): Promise<GenerateAnswer | null> {
  const outcome = await askModelOutcome(task, call);
  return outcome.ok ? outcome.answer : null;
}

/**
 * Why a call did not come: the gateway's own kind of refusal when Gemini
 * refused (`GatewayCause` — a quota, a key, a missing model), or what went
 * wrong between here and the gateway. A drawing says it to an administrator,
 * who can turn billing on; every other feature reads only whether it came.
 */
export type ModelMiss = GatewayCause | "not_configured" | "unreachable" | "busy";

export async function askModelOutcome(task: ServerTask, call: ModelCall): Promise<{ ok: true; answer: GenerateAnswer } | { ok: false; miss: ModelMiss }> {
  const origin = gatewayOrigin();
  if (!origin || !gatewayConfigured()) return { ok: false, miss: "not_configured" };
  const body: GenerateRequest = {
    system: call.system,
    prompt: call.prompt,
    image: call.image ?? null,
    images: call.images ?? [],
    json: call.json,
    search: call.search ?? false,
    output: call.output ?? "text",
    ...(call.aspectRatio ? { aspectRatio: call.aspectRatio } : {}),
    temperature: call.temperature,
    maxOutputTokens: call.maxOutputTokens,
    timeoutMs: Math.max(500, call.deadlineMs - 300),
  };
  try {
    const exp = Math.floor(Date.now() / 1000) + SERVER_TOKEN_SECONDS;
    const token = await signGatewayToken({ v: 1, scope: "server", sub: `s:${task}`, vendor: null, exp }, ENV.aiGatewaySecret);
    const response = await fetch(`${origin}${GATEWAY_ROUTES.server}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(call.deadlineMs),
    });
    if (!response.ok) {
      const refused = (await response.json().catch(() => null)) as GatewayResponse<GenerateAnswer> | null;
      const error = refused && !refused.ok ? refused.error : null;
      const miss: ModelMiss = error?.cause ?? (error?.code === "rate_limited" ? "busy" : "unreachable");
      console.warn(`[model] ${task} refused: ${response.status} ${error?.code ?? "?"} ${miss}`);
      return { ok: false, miss };
    }
    const answer = (await response.json()) as GatewayResponse<GenerateAnswer>;
    return answer.ok && typeof answer.data?.text === "string" ? { ok: true, answer: answer.data } : { ok: false, miss: "malformed" };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, miss: timedOut ? "timeout" : "unreachable" };
  }
}

/** The model's text, or null for every way it did not come. */
export async function askModel(task: ServerTask, call: ModelCall): Promise<string | null> {
  return (await askModelFor(task, call))?.text ?? null;
}

/** A model's JSON object, or null when it is not one. */
export function parseObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
