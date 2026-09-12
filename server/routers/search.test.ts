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
async function callerWithKey(apiKey?: string) {
  if (apiKey) vi.stubEnv("MISTRAL_API_KEY", apiKey);
  vi.resetModules();
  const { searchRouter } = await import("./search");
  return searchRouter.createCaller({} as never);
}

const query = { query: "quiet coffee", catalogTitles: ["Brew Mini Espresso Maker"] };

describe("AI search response parsing", () => {
  it("uses Mistral's structured refinement while bounding the returned terms", () => {
    const result = parseRefinedSearch('{"query":"espresso maker","terms":["espresso","coffee","maker","kitchen","morning","extra"]}', "coffee machine");
    expect(result).toEqual({ query: "espresso maker", terms: ["espresso", "coffee", "maker", "kitchen", "morning"] });
  });

  it("falls back to the shopper's original query when a response is malformed", () => {
    expect(parseRefinedSearch("not json", "wireless audio")).toEqual({ query: "wireless audio", terms: [] });
  });

  it("returns a typed error when Mistral is unavailable so local search can remain active", async () => {
    const caller = await callerWithKey("test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("service unavailable", { status: 503 })));
    await expect(caller.refine(query)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("reports a missing credential distinctly from an outage", async () => {
    // Without this the previous test passes for the wrong reason: the key guard
    // fires before fetch, so an unconfigured environment never reaches the
    // outage path it means to exercise.
    const caller = await callerWithKey();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(caller.refine(query)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
