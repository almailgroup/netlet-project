import { describe, expect, it } from "vitest";
import { followFlags } from "./follows.js";

describe("followFlags", () => {
  it("starts a back-in-stock reminder without price-drop notices", () => {
    expect(followFlags({ backInStock: true }, null)).toEqual({ priceDrop: false, backInStock: true });
  });

  it("starts a price-drop follow without a back-in-stock reminder", () => {
    expect(followFlags({ priceDrop: true }, undefined)).toEqual({ priceDrop: true, backInStock: false });
  });

  it("keeps what the row already says for a flag the request left out", () => {
    expect(followFlags({ backInStock: true }, { priceDrop: true, backInStock: false })).toEqual({ priceDrop: true, backInStock: true });
    expect(followFlags({ priceDrop: false }, { priceDrop: true, backInStock: true })).toEqual({ priceDrop: false, backInStock: true });
  });

  it("is no follow at all once both are off", () => {
    expect(followFlags({ backInStock: false }, { priceDrop: false, backInStock: true })).toBeNull();
    expect(followFlags({}, null)).toBeNull();
  });
});
