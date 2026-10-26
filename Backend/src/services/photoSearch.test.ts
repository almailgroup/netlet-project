/**
 * The photo-search call (3.1.6), with the network faked.
 *
 * What may be sent and what a reply may become are proved pure in
 * `Shared/commerce/photoSearch.test.ts`. This is the call: that it sends the
 * photo and nothing about the shopper, that it asks in the shopper's language,
 * and that every failure lands on one answer.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let photo: typeof import("./photoSearch.js");
const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

/* "Find similar" reads one product row; this is that row, or none. */
let productRows: { title: string; titleAr: string | null }[] = [];
const chain = {
  select: () => chain,
  from: () => chain,
  innerJoin: () => chain,
  where: () => chain,
  limit: async () => productRows,
};

beforeAll(async () => {
  vi.stubEnv("AI_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("AI_GATEWAY_SECRET", "k".repeat(48));
  vi.doMock("./features", () => ({ featureOn: async () => true }));
  vi.doMock("./db", () => ({ getDb: async () => chain }));
  vi.doMock("./aiImages", () => ({
    departmentOf: async () => "home-and-kitchen",
    productPhoto: async () => ({ mimeType: "image/jpeg", data: "/9j/4AAQ" }),
  }));
  photo = await import("./photoSearch.js");
});

afterEach(() => vi.unstubAllGlobals());

/* The AI gateway, as far as the call can tell: one answer's text. */
function replying(status: number, content: unknown) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, headers: new Headers(init.headers), body: JSON.parse(init.body) });
    const body = status === 200 ? { ok: true, data: { text: content } } : { ok: false, error: { code: "model_unavailable", message: "x" } };
    return new Response(JSON.stringify(body), { status });
  }));
  return calls;
}

describe("reading a photo", () => {
  it("sends the photo and the instructions, and nothing about the shopper", async () => {
    const calls = replying(200, '{"query": "brass table lamp"}');
    expect(await photo.describePhoto(IMAGE, "en")).toEqual({ kind: "query", query: "brass table lamp" });
    expect(calls[0].url).toBe("https://gateway.test/api/ai/generate");
    expect(calls[0].headers.get("authorization")).toMatch(/^Bearer v1\./);
    expect(calls[0].body.image).toEqual({ mimeType: "image/jpeg", data: "/9j/4AAQSkZJRgABAQ==" });
    expect(calls[0].body.prompt).toBe("");
    /* The whole request: the instructions, the photo and the call's settings. */
    expect(Object.keys(calls[0].body).sort()).toEqual(["image", "images", "json", "maxOutputTokens", "output", "prompt", "search", "system", "temperature", "timeoutMs"]);
    /* No second picture, no search and words back: only the shopper's photo goes. */
    expect(calls[0].body).toMatchObject({ images: [], search: false, output: "text" });
  });

  it("asks in the shopper's language", async () => {
    const calls = replying(200, '{"query": "مصباح نحاسي"}');
    expect(await photo.describePhoto(IMAGE, "ar")).toEqual({ kind: "query", query: "مصباح نحاسي" });
    expect(calls[0].body.system).toContain("Arabic");
  });

  it("says nothing was found when there is no product in frame", async () => {
    replying(200, '{"query": ""}');
    expect(await photo.describePhoto(IMAGE, "en")).toEqual({ kind: "nothing" });
  });

  it("lands every failure on one answer", async () => {
    replying(500, "boom");
    expect(await photo.describePhoto(IMAGE, "en")).toEqual({ kind: "unavailable" });
    replying(200, 42);
    expect(await photo.describePhoto(IMAGE, "en")).toEqual({ kind: "unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    expect(await photo.describePhoto(IMAGE, "en")).toEqual({ kind: "unavailable" });
  });
});

describe("finding similar from a product page", () => {
  it("sends the product's own photo and title, fenced, and searches its department", async () => {
    productRows = [{ title: "Philips Airfryer XL HD9270, black", titleAr: "قلاية هوائية فيليبس" }];
    const calls = replying(200, '{"query": "black air fryer"}');
    expect(await photo.similarTo(7, "en")).toEqual({ kind: "query", query: "black air fryer", department: "home-and-kitchen" });
    expect(calls[0].body.image).toEqual({ mimeType: "image/jpeg", data: "/9j/4AAQ" });
    expect(calls[0].body.prompt).toBe("Product title: <<<Philips Airfryer XL HD9270, black>>>");
    /* Alternatives, not the same listing again. */
    expect(calls[0].body.system).toContain("Never include the brand");
  });

  it("names it in Arabic from the Arabic title on the Arabic page", async () => {
    productRows = [{ title: "Philips Airfryer", titleAr: "قلاية هوائية فيليبس" }];
    const calls = replying(200, '{"query": "قلاية هوائية"}');
    expect(await photo.similarTo(7, "ar")).toMatchObject({ kind: "query", query: "قلاية هوائية" });
    expect(calls[0].body.system).toContain("Arabic");
    expect(calls[0].body.prompt).toContain("قلاية هوائية فيليبس");
  });

  it("falls back to the department, never a dead button", async () => {
    productRows = [{ title: "Lamp", titleAr: null }];
    replying(500, "boom");
    expect(await photo.similarTo(7, "en")).toEqual({ kind: "department", department: "home-and-kitchen" });
    replying(200, '{"query": ""}');
    expect(await photo.similarTo(7, "en")).toEqual({ kind: "department", department: "home-and-kitchen" });
  });

  it("finds nothing for a product the shop does not show", async () => {
    productRows = [];
    expect(await photo.similarTo(7, "en")).toBeNull();
  });
});
