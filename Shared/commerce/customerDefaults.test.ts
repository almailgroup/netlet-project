import { describe, expect, it } from "vitest";
import { choosablePayments, defaultPayment, isPaymentMethod, PAYMENT_METHODS, startingAddressId } from "./customerDefaults";

describe("the way to pay", () => {
  it("offers cash while the shop takes it, and nothing else until a card service", () => {
    expect(choosablePayments({ cashOnDelivery: true })).toEqual(["cod"]);
    expect(choosablePayments({ cashOnDelivery: false })).toEqual([]);
  });

  it("starts from the one kept while it can be chosen, else the first that can", () => {
    expect(defaultPayment("cod", ["cod"])).toBe("cod");
    expect(defaultPayment("knet", ["cod"])).toBe("cod");
    expect(defaultPayment(null, ["cod"])).toBe("cod");
    expect(defaultPayment("bitcoin", ["cod"])).toBe("cod");
    expect(defaultPayment("cod", [])).toBeNull();
  });

  it("knows its four ways and nothing else", () => {
    expect(PAYMENT_METHODS).toEqual(["cod", "knet", "card", "apple_pay"]);
    expect(isPaymentMethod("apple_pay")).toBe(true);
    expect(isPaymentMethod("cash")).toBe(false);
    expect(isPaymentMethod(4)).toBe(false);
  });
});

describe("the address an order starts from", () => {
  const book = [{ id: 4 }, { id: 7 }];
  it("is the account's default while it is in the book", () => {
    expect(startingAddressId(book, 7, 4)).toBe(7);
  });
  it("is this device's last when the account has none, or one no longer in the book", () => {
    expect(startingAddressId(book, null, 4)).toBe(4);
    expect(startingAddressId(book, 99, 4)).toBe(4);
  });
  it("is none rather than an id that is not in the book", () => {
    expect(startingAddressId(book, 99, 98)).toBeNull();
    expect(startingAddressId([], 4, 4)).toBeNull();
  });
});
