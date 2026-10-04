import { describe, expect, it } from "vitest";
import { MAX_INBOUND_LINES, MAX_INBOUND_UNITS, inboundProblem, inboundReference, mayMoveLine, receiptGap, validCount } from "./netletFulfilment.js";

describe("an announcement", () => {
  it("lists something, a whole number of each, each once", () => {
    expect(inboundProblem([])).toBe("fulfilment.noLines");
    expect(inboundProblem([{ variantId: 1, quantity: 0 }])).toBe("fulfilment.badQuantity");
    expect(inboundProblem([{ variantId: 1, quantity: 1.5 }])).toBe("fulfilment.badQuantity");
    expect(inboundProblem([{ variantId: 1, quantity: MAX_INBOUND_UNITS + 1 }])).toBe("fulfilment.badQuantity");
    expect(inboundProblem([{ variantId: 1, quantity: 2 }, { variantId: 1, quantity: 3 }])).toBe("fulfilment.duplicateLine");
    expect(inboundProblem(Array.from({ length: MAX_INBOUND_LINES + 1 }, (_, i) => ({ variantId: i, quantity: 1 })))).toBe("fulfilment.tooManyLines");
    expect(inboundProblem([{ variantId: 1, quantity: 12 }])).toBeNull();
  });
});

describe("a count", () => {
  it("may be zero — nothing arrived is a real count — and never negative or fractional", () => {
    expect(validCount(0)).toBe(true);
    expect(validCount(-1)).toBe(false);
    expect(validCount(2.5)).toBe(false);
  });

  it("shows the gap rather than leaving it to be worked out", () => {
    expect(receiptGap(10, 9)).toEqual({ short: 1, over: 0 });
    expect(receiptGap(10, 12)).toEqual({ short: 0, over: 2 });
    expect(receiptGap(4, 4)).toEqual({ short: 0, over: 0 });
  });
});

describe("who moves a line", () => {
  it("is the seller for their own shelf and NetLet for a centre's", () => {
    expect(mayMoveLine(null, "vendor")).toBe(true);
    expect(mayMoveLine(3, "vendor")).toBe(false);
    expect(mayMoveLine(3, "admin")).toBe(true);
  });
});

it("gives a reference a person can read down a phone", () => {
  const reference = inboundReference(new Date(Date.UTC(2026, 9, 4)), () => 0);
  expect(reference).toBe("IN-20261004-AAAAA");
  expect(inboundReference(new Date())).toMatch(/^IN-\d{8}-[ABCDEFGHJKMNPQRTUVWXYZ2346789]{5}$/);
});
