/**
 * NetLet's own model calls, end to end through the real gateway: the
 * server's `askModel` signs a `server` token and posts, and the Worker's own
 * fetch handler (`workers/ai-gateway/src/index.ts`) checks it and asks a
 * stand-in Gemini. Both halves of the contract, met where they meet.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handle } from "../workers/ai-gateway/src/index.js";
import { verifyGatewayToken } from "../Shared/ai/gateway.js";

const SECRET = "s".repeat(48);
let gemini: typeof import("./gemini.js");

beforeAll(async () => {
  vi.stubEnv("AI_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("AI_GATEWAY_SECRET", SECRET);
  vi.doMock("./features", () => ({ featureOn: async () => true }));
  gemini = await import("./gemini.js");
});

afterEach(() => vi.unstubAllGlobals());

/** Requests reach the Worker's handler; the handler's Gemini answers `text`. */
function throughWorker(text: string, options: { status?: number } = {}) {
  const sentToGemini: Record<string, unknown>[] = [];
  const tokens: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    tokens.push(new Headers(init.headers).get("authorization")!.replace("Bearer ", ""));
    return handle(new Request(url, init), { GEMINI_API_KEY: "test", AI_GATEWAY_SECRET: SECRET }, {
      fetcher: (async (_input: RequestInfo | URL, request?: RequestInit) => {
        sentToGemini.push(JSON.parse(String(request?.body)));
        if (options.status) return new Response("quota", { status: options.status });
        return Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
      }) as typeof fetch,
    });
  }));
  return { sentToGemini, tokens };
}

const call = { system: "Translate the name.", prompt: "Product name:\n<<<Brass lamp>>>", json: false, temperature: 0.2, maxOutputTokens: 80, deadlineMs: 8000 };

describe("asking the model from the server", () => {
  it("goes through the gateway with a server token naming the feature, and returns the text", async () => {
    const { sentToGemini, tokens } = throughWorker("مصباح نحاسي");
    expect(await gemini.askModel("arabicName", call)).toBe("مصباح نحاسي");
    const claims = await verifyGatewayToken(tokens[0], SECRET, Math.floor(Date.now() / 1000));
    expect(claims).toMatchObject({ scope: "server", sub: "s:arabicName", vendor: null });
    /* Made for one call: a minute, not the five a browser's token lives. */
    expect(claims!.exp - Date.now() / 1000).toBeLessThanOrEqual(61);
    expect(sentToGemini[0]).toMatchObject({
      systemInstruction: { parts: [{ text: "Translate the name." }] },
      contents: [{ role: "user", parts: [{ text: "Product name:\n<<<Brass lamp>>>" }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 80 },
    });
  });

  it("gives the Worker a little less time than it waits itself", async () => {
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true, data: { text: "x" } });
    }));
    await gemini.askModel("searchRefine", { ...call, deadlineMs: 5000 });
    await gemini.askModel("recommendOrder", { ...call, deadlineMs: 600 });
    expect(seen.map(body => body.timeoutMs)).toEqual([4700, 500]);
  });

  it("lands every failure on null: a Gemini error, a refusal, a timeout, an answer that is not one", async () => {
    throughWorker("x", { status: 429 });
    expect(await gemini.askModel("supportDraft", call)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, data: { text: 42 } })));
    expect(await gemini.askModel("supportDraft", call)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }));
    expect(await gemini.askModel("supportDraft", call)).toBeNull();
  });

  it("reads a JSON object and nothing else", () => {
    expect(gemini.parseObject('{"order":["1"]}')).toEqual({ order: ["1"] });
    for (const text of [null, "", "not json", "[1,2]", "42", "null"]) expect(gemini.parseObject(text)).toBeNull();
  });
});

describe("with no gateway", () => {
  it("asks nobody", async () => {
    vi.resetModules();
    vi.stubEnv("AI_GATEWAY_URL", "");
    const bare = await import("./gemini.js");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await bare.askModel("photoSearch", call)).toBeNull();
    expect(await bare.modelAvailable()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.stubEnv("AI_GATEWAY_URL", "https://gateway.test");
  });
});
