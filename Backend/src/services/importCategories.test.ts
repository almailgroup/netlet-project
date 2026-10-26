/**
 * The model's pass over a spreadsheet's unplaced rows (3.3.5), with the
 * gateway faked. What a reply may become is proved pure in
 * `Shared/inventory/bulkUpload.test.ts`; this is the call: the rows' own words
 * go, fenced, and nothing about the store; a seller files only for their own
 * store; and every failure is "no more filed".
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let service: typeof import("./importCategories.js");
let allowance = true;
const manager: Actor = { kind: "vendor", userId: 7, vendorId: 3, role: "manager" };

beforeAll(async () => {
  vi.stubEnv("AI_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("AI_GATEWAY_SECRET", "k".repeat(48));
  vi.doMock("./features", () => ({ featureOn: async () => true }));
  vi.doMock("./rateLimit", () => ({ takeHourlyAllowance: async () => allowance }));
  service = await import("./importCategories.js");
});

afterEach(() => { vi.unstubAllGlobals(); allowance = true; });

function replying(status: number, content: unknown) {
  const calls: { body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    calls.push({ body: JSON.parse(init.body) });
    const body = status === 200 ? { ok: true, data: { text: content } } : { ok: false, error: { code: "model_unavailable", message: "x" } };
    return new Response(JSON.stringify(body), { status });
  }));
  return calls;
}

describe("filing a spreadsheet's unplaced rows", () => {
  it("sends the rows' own words, fenced, and keeps only the shop's departments", async () => {
    const calls = replying(200, '{"4": "Home & Kitchen", "5": "Toys"}');
    const reply = await service.categoriseRows(manager, [{ line: 4, text: "Ceramic teapot, 1L" }, { line: 5, text: "Wooden puzzle" }]);
    expect(reply).toEqual({ filed: { 4: "Home & Kitchen" }, available: true });
    expect(calls[0].body.prompt).toBe("4: <<<Ceramic teapot, 1L>>>\n5: <<<Wooden puzzle>>>");
    expect(calls[0].body.system).toContain("Electronics, Home & Kitchen, Beauty, Style, Grocery");
  });

  it("files nothing once the hour's allowance is spent, or when the model fails", async () => {
    allowance = false;
    expect(await service.categoriseRows(manager, [{ line: 4, text: "Teapot" }])).toEqual({ filed: {}, available: false });
    allowance = true;
    replying(500, "boom");
    expect(await service.categoriseRows(manager, [{ line: 4, text: "Teapot" }])).toEqual({ filed: {}, available: false });
  });

  it("is refused to somebody who cannot create a product there", async () => {
    const staff: Actor = { kind: "vendor", userId: 8, vendorId: 3, role: "staff" };
    await expect(service.categoriseRows(staff, [{ line: 4, text: "Teapot" }])).rejects.toThrow(/FORBIDDEN/);
  });
});
