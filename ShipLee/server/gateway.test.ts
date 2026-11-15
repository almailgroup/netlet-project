import { describe, expect, it } from "vitest";
import { aiFromEnv, askModel, signAiToken } from "./gateway.js";

const SECRET = "s".repeat(48);
const NOW = 1_800_000_000_000;

describe("ShipLee AI's line to the gateway", () => {
  it("signs the exact token the Worker's own test verifies", () => {
    /* Backend/gateway/src/index.test.ts holds this string too: change one side and both fail. */
    expect(signAiToken("assistant", SECRET, NOW)).toBe(
      "v1.eyJ2IjoxLCJhcHAiOiJzaGlwbGVlIiwidGFzayI6ImFzc2lzdGFudCIsImV4cCI6MTgwMDAwMDA2MH0.WlZPF90kMU6F4-BMX4N4bfOhbOH8VDcs3Bp9lhOGejw",
    );
  });

  it("is set up only with the Worker's own address and a long enough secret", () => {
    expect(aiFromEnv({ SHIPLEE_AI_URL: "https://gateway.example.workers.dev/", SHIPLEE_AI_SECRET: SECRET })).toEqual({ url: "https://gateway.example.workers.dev", secret: SECRET });
    expect(aiFromEnv({ SHIPLEE_AI_URL: "http://127.0.0.1:8787", SHIPLEE_AI_SECRET: SECRET })?.url).toBe("http://127.0.0.1:8787");
    for (const url of ["http://gateway.example", "https://gateway.example/api", "https://user:pw@gateway.example", "not a url", ""]) {
      expect(aiFromEnv({ SHIPLEE_AI_URL: url, SHIPLEE_AI_SECRET: SECRET }), url).toBeNull();
    }
    expect(aiFromEnv({ SHIPLEE_AI_URL: "https://gateway.example", SHIPLEE_AI_SECRET: "short" })).toBeNull();
    expect(aiFromEnv({})).toBeNull();
  });

  it("answers null for every way the gateway does not answer, and never throws", async () => {
    const ai = { url: "https://gateway.example", secret: SECRET };
    const call = { task: "assistant" as const, system: "s", prompt: "p", json: true, temperature: 0, maxOutputTokens: 10, timeoutMs: 1000 };
    const answering = (response: Response | Error) => (async () => { if (response instanceof Error) throw response; return response; }) as unknown as typeof fetch;
    expect(await askModel(ai, call, { fetcher: answering(Response.json({ ok: true, data: { text: "{}" } })), now: () => NOW })).toBe("{}");
    expect(await askModel(ai, call, { fetcher: answering(Response.json({ ok: false, error: { code: "rate_limited" } }, { status: 429 })) })).toBeNull();
    expect(await askModel(ai, call, { fetcher: answering(new Response("<html>", { status: 502 })) })).toBeNull();
    expect(await askModel(ai, call, { fetcher: answering(Response.json({ ok: true, data: {} })) })).toBeNull();
    expect(await askModel(ai, call, { fetcher: answering(new TypeError("fetch failed")) })).toBeNull();
  });
});
