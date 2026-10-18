/**
 * The Worker's only conversation with Gemini.
 *
 * Three calls — one answer as text, one as JSON, one as a stream — and one rule for
 * every way they fail: a refused key, a quota, a 500, a timeout, a body that
 * is not JSON all become `GeminiFailure`, and the route turns that into
 * `model_unavailable`. The browser is never shown Google's own error text,
 * which can carry the project's name and quota details.
 *
 * Thinking is off (`thinkingBudget: 0`): 2.5 Flash otherwise spends time and
 * tokens reasoning before the first word, which a chat streaming to a phone
 * feels as a pause and these two tasks — answering from a brief, filling a
 * form — do not need.
 */
import { createSseReader } from "../../../Shared/ai/gateway.js";

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type GeminiCall = {
  apiKey: string;
  model: string;
  system: string;
  contents: GeminiContent[];
  temperature: number;
  maxOutputTokens: number;
  /** Asks for JSON held to this schema (Gemini's OpenAPI subset). */
  schema?: unknown;
  /** Asks for a JSON object with no schema: NetLet's server holds the answer to its own rules. */
  json?: boolean;
  /** Grounds the answer in a Google search (text only). */
  search?: boolean;
  /** Asks the drawing model for a picture: no thinking, no token cap, an image back. */
  draw?: boolean;
  timeoutMs: number;
  /** The fetch to use; the tests hand in their own. */
  fetcher?: typeof fetch;
};

export class GeminiFailure extends Error {
  constructor(readonly reason: "http" | "timeout" | "blocked" | "malformed", detail: string) {
    super(detail);
  }
}

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } }[] };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
};

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function requestBody(call: GeminiCall): string {
  /* The drawing model takes no thinking budget and no word cap: a picture is
     counted in its own tokens, and a cap on words would cut it off. */
  const generationConfig = call.draw
    ? { temperature: call.temperature, responseModalities: ["IMAGE", "TEXT"] }
    : {
        temperature: call.temperature,
        maxOutputTokens: call.maxOutputTokens,
        thinkingConfig: { thinkingBudget: 0 },
        ...(call.schema || call.json ? { responseMimeType: "application/json" } : {}),
        ...(call.schema ? { responseSchema: call.schema } : {}),
      };
  return JSON.stringify({
    systemInstruction: { parts: [{ text: call.system }] },
    contents: call.contents,
    ...(call.search ? { tools: [{ google_search: {} }] } : {}),
    generationConfig,
  });
}

async function post(call: GeminiCall, path: string): Promise<Response> {
  let response: Response;
  try {
    response = await (call.fetcher ?? fetch)(`${ENDPOINT}/${encodeURIComponent(call.model)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": call.apiKey },
      body: requestBody(call),
      signal: AbortSignal.timeout(call.timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new GeminiFailure(timedOut ? "timeout" : "http", String(error));
  }
  if (!response.ok) {
    /* Read and dropped: Google's text names the project and its quota. */
    await response.text().catch(() => "");
    throw new GeminiFailure("http", `Gemini answered ${response.status}`);
  }
  return response;
}

/** The answer's text, never a thought. */
function textOf(body: GeminiResponse): string {
  return (body.candidates?.[0]?.content?.parts ?? [])
    .filter(part => !part.thought && typeof part.text === "string")
    .map(part => part.text)
    .join("");
}

const BLOCKED = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "RECITATION"]);

/** One answer, as its text. */
export async function generateText(call: GeminiCall): Promise<string> {
  const response = await post(call, ":generateContent");
  let body: GeminiResponse;
  try {
    body = (await response.json()) as GeminiResponse;
  } catch {
    throw new GeminiFailure("malformed", "Gemini's answer was not JSON");
  }
  if (body.promptFeedback?.blockReason || BLOCKED.has(body.candidates?.[0]?.finishReason ?? "")) {
    throw new GeminiFailure("blocked", body.promptFeedback?.blockReason ?? body.candidates?.[0]?.finishReason ?? "blocked");
  }
  return textOf(body);
}

export type GeminiParts = {
  text: string;
  image: { mimeType: string; data: string } | null;
  /** The pages a grounded answer read, as the search returned them. */
  sources: { uri: string; title: string }[];
};

/**
 * One answer with everything in it: its words, the first picture it drew,
 * and, for a grounded answer, the pages the search found. The sources come
 * from `groundingMetadata` — Google's record of the search — never from the
 * words, which a model can make up.
 */
export async function generateParts(call: GeminiCall): Promise<GeminiParts> {
  const response = await post(call, ":generateContent");
  let body: GeminiResponse;
  try {
    body = (await response.json()) as GeminiResponse;
  } catch {
    throw new GeminiFailure("malformed", "Gemini's answer was not JSON");
  }
  if (body.promptFeedback?.blockReason || BLOCKED.has(body.candidates?.[0]?.finishReason ?? "")) {
    throw new GeminiFailure("blocked", body.promptFeedback?.blockReason ?? body.candidates?.[0]?.finishReason ?? "blocked");
  }
  const candidate = body.candidates?.[0];
  const drawn = (candidate?.content?.parts ?? []).find(part => part.inlineData?.data && part.inlineData.mimeType?.startsWith("image/"));
  const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .flatMap(chunk => chunk.web?.uri ? [{ uri: chunk.web.uri, title: (chunk.web.title ?? "").slice(0, 200) }] : [])
    .slice(0, 10);
  if (call.draw && !drawn) throw new GeminiFailure("malformed", "Gemini drew nothing");
  return {
    text: textOf(body),
    image: drawn?.inlineData ? { mimeType: drawn.inlineData.mimeType!, data: drawn.inlineData.data! } : null,
    sources,
  };
}

/** One answer, parsed as JSON. */
export async function generateJson(call: GeminiCall): Promise<unknown> {
  const text = await generateText(call);
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiFailure("malformed", "Gemini's text was not the JSON asked for");
  }
}

export type StreamPiece = { kind: "text"; text: string } | { kind: "finish"; finish: "stop" | "length" | "blocked" };

/**
 * The answer as it is written, piece by piece. The request itself is made
 * before this returns, so a refused key or a quota is thrown here — while the
 * route can still answer with a status — rather than discovered once the
 * browser has been sent a 200.
 */
export async function streamText(call: GeminiCall): Promise<AsyncGenerator<StreamPiece>> {
  const response = await post(call, ":streamGenerateContent?alt=sse");
  if (!response.body) throw new GeminiFailure("malformed", "Gemini sent no stream");
  const body = response.body;
  return (async function* pieces(): AsyncGenerator<StreamPiece> {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    const queue: StreamPiece[] = [];
    let finished: StreamPiece | null = null;
    const sse = createSseReader(data => {
      let chunk: GeminiResponse;
      try {
        chunk = JSON.parse(data) as GeminiResponse;
      } catch {
        return;
      }
      const text = textOf(chunk);
      if (text) queue.push({ kind: "text", text });
      const reason = chunk.promptFeedback?.blockReason ? "SAFETY" : chunk.candidates?.[0]?.finishReason;
      if (reason) finished = { kind: "finish", finish: reason === "MAX_TOKENS" ? "length" : BLOCKED.has(reason) ? "blocked" : "stop" };
    });
    let drained = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        sse.push(value);
        while (queue.length) yield queue.shift()!;
      }
      drained = true;
      sse.end();
      while (queue.length) yield queue.shift()!;
    } finally {
      /* A shopper who pressed Stop, or closed the page: Gemini stops writing too, and stops billing. */
      if (!drained) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    yield finished ?? { kind: "finish", finish: "stop" };
  })();
}
