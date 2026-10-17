import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRefinedSearch } from "./search.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

/**
 * `ENV` snapshots process.env when its module first loads, so a router imported
 * at the top of this file would capture whatever key was present then. Importing
 * after stubbing — with the module registry reset — is what lets these tests pin
 * the configured and unconfigured paths independently.
 */
async function callerWithGateway(configured: boolean) {
  if (configured) {
    vi.stubEnv("AI_GATEWAY_URL", "https://gateway.test");
    vi.stubEnv("AI_GATEWAY_SECRET", "k".repeat(48));
  }
  vi.resetModules();
  vi.doMock("../features", () => ({ featureOn: async () => true }));
  vi.doMock("../rateLimit", () => ({
    checkSearchRefineAllowed: async () => ({ allowed: true }),
    recordSearchRefine: async () => undefined,
    checkPhotoSearchAllowed: async () => ({ allowed: true }),
    recordPhotoSearch: async () => undefined,
  }));
  const { searchRouter } = await import("./search");
  return searchRouter.createCaller({ req: { ip: "203.0.113.9" } } as never);
}

const query = { query: "quiet coffee", catalogTitles: ["Brew Mini Espresso Maker"] };

describe("AI search response parsing", () => {
  it("reads the model's structured refinement while bounding the returned terms", () => {
    const result = parseRefinedSearch('{"query":"espresso maker","terms":["espresso","coffee","maker","kitchen","morning","extra"]}', "coffee machine");
    expect(result).toEqual({ query: "espresso maker", terms: ["espresso", "coffee", "maker", "kitchen", "morning"] });
  });

  it("falls back to the shopper's original query when a response is malformed", () => {
    expect(parseRefinedSearch("not json", "wireless audio")).toEqual({ query: "wireless audio", terms: [] });
  });

  it("asks Gemini through the gateway, and reads its answer with the same rule", async () => {
    const caller = await callerWithGateway(true);
    const fetchSpy = vi.fn(async (_url: string, _init: { body: string }) => Response.json({ ok: true, data: { text: '{"query":"espresso maker","terms":["espresso"]}' } }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await caller.refine(query)).toEqual({ query: "espresso maker", terms: ["espresso"] });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://gateway.test/api/ai/generate");
    expect(JSON.parse(init.body)).toMatchObject({ json: true, prompt: expect.stringContaining("Brew Mini Espresso Maker") });
  });

  it("returns a typed error when the model is unavailable so local search can remain active", async () => {
    const caller = await callerWithGateway(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("service unavailable", { status: 503 })));
    await expect(caller.refine(query)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("reports a missing credential distinctly from an outage", async () => {
    // Without this the previous test passes for the wrong reason: the key guard
    // fires before fetch, so an unconfigured environment never reaches the
    // outage path it means to exercise.
    const caller = await callerWithGateway(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(caller.refine(query)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
