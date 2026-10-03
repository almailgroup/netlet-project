/**
 * The photo-search call (3.1.6), with the network faked.
 *
 * What may be sent and what a reply may become are proved pure in
 * `shared/commerce/photoSearch.test.ts`. This is the call: that it sends the
 * photo and nothing about the shopper, that it asks in the shopper's language,
 * and that every failure lands on one answer.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let photo: typeof import("./photoSearch.js");
const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

beforeAll(async () => {
  vi.stubEnv("MISTRAL_API_KEY", "test-key-not-real");
  vi.doMock("./features", () => ({ featureOn: async () => true }));
  photo = await import("./photoSearch.js");
});

afterEach(() => vi.unstubAllGlobals());

function replying(status: number, content: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
  }));
  return calls;
}

describe("reading a photo", () => {
  it("sends the photo and the instructions, and nothing about the shopper", async () => {
    const calls = replying(200, '{"query": "brass table lamp"}');
    expect(await photo.describePhoto(IMAGE, "en")).toEqual({ kind: "query", query: "brass table lamp" });
    const messages = calls[0].body.messages as Array<{ role: string; content: unknown }>;
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toEqual([{ type: "image_url", image_url: IMAGE }]);
    /* The whole request: a model, its settings, the instructions and the photo. */
    expect(Object.keys(calls[0].body).sort()).toEqual(["max_tokens", "messages", "model", "response_format", "temperature"]);
    expect(messages.map(message => message.role)).toEqual(["system", "user"]);
  });

  it("asks in the shopper's language", async () => {
    const calls = replying(200, '{"query": "مصباح نحاسي"}');
    expect(await photo.describePhoto(IMAGE, "ar")).toEqual({ kind: "query", query: "مصباح نحاسي" });
    expect((calls[0].body.messages as Array<{ content: string }>)[0].content).toContain("Arabic");
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
