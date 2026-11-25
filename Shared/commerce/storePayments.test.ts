import { describe, expect, it } from "vitest";
import {
  cleanOnline,
  isStoreMethod,
  payableNow,
  payLine,
  sharedMethods,
  storeMethodKey,
  storeMethods,
  storeMethodsProblem,
  STORE_METHODS,
} from "./storePayments.js";

describe("the ways a store takes", () => {
  it("are all four for a store that has not chosen", () => {
    expect(storeMethods(true, null)).toEqual(["cod", "knet", "card", "apple_pay"]);
    expect(storeMethods(false, null)).toEqual(["knet", "card", "apple_pay"]);
  });

  it("are its cash switch and the online ones it ticked, in the shop's order", () => {
    expect(storeMethods(true, ["apple_pay", "knet"])).toEqual(["cod", "knet", "apple_pay"]);
    expect(storeMethods(true, [])).toEqual(["cod"]);
    expect(storeMethods(false, ["card"])).toEqual(["card"]);
  });

  it("drop what is not an online way, once each", () => {
    expect(cleanOnline(["card", "cod", "card", "paypal", 7, null, "knet"])).toEqual(["knet", "card"]);
    expect(cleanOnline(null)).toEqual([]);
    expect(isStoreMethod("cod")).toBe(true);
    expect(isStoreMethod("paypal")).toBe(false);
  });

  it("must keep one at least", () => {
    expect(storeMethodsProblem(false, [])).toBe("storePay.needOne");
    expect(storeMethodsProblem(false, ["bitcoin"])).toBe("storePay.needOne");
    expect(storeMethodsProblem(true, [])).toBeNull();
    expect(storeMethodsProblem(false, ["knet"])).toBeNull();
  });

  it("are named by the dictionary", () => {
    expect(STORE_METHODS.map(storeMethodKey)).toEqual(["storePay.method.cod", "storePay.method.knet", "storePay.method.card", "storePay.method.apple_pay"]);
  });
});

describe("what a basket's stores share", () => {
  const store = (vendorId: number, methods: ("cod" | "knet" | "card" | "apple_pay")[]) => ({ vendorId, methods });

  it("is what every store takes", () => {
    expect(sharedMethods([store(1, ["cod", "knet", "card"]), store(2, ["knet", "card", "apple_pay"])])).toEqual({ methods: ["knet", "card"], differs: null });
    expect(sharedMethods([store(1, ["cod"])])).toEqual({ methods: ["cod"], differs: null });
  });

  it("names the first store that leaves nothing in common", () => {
    const result = sharedMethods([store(1, ["cod", "knet"]), store(2, ["cod"]), store(3, ["apple_pay"]), store(4, ["card"])]);
    expect(result.methods).toEqual([]);
    expect(result.differs?.vendorId).toBe(3);
  });

  it("is everything for an empty basket", () => {
    expect(sharedMethods([])).toEqual({ methods: ["cod", "knet", "card", "apple_pay"], differs: null });
  });
});

describe("how a shopper reads them today", () => {
  it("puts cash now and the online ways as coming, while online payment is not live", () => {
    expect(payLine(["cod", "knet", "apple_pay"])).toEqual({ now: ["cod"], soon: ["knet", "apple_pay"] });
    expect(payLine(["knet"])).toEqual({ now: [], soon: ["knet"] });
    expect(payableNow(["knet", "card"])).toBe(false);
    expect(payableNow(["cod"])).toBe(true);
  });

  it("puts every way now once it is live", () => {
    expect(payLine(["cod", "knet"], true)).toEqual({ now: ["cod", "knet"], soon: [] });
    expect(payableNow(["knet"], true)).toBe(true);
  });
});
