import { describe, expect, it } from "vitest";
import { CARD_METHODS_ARE_DISPLAY_ONLY, KUWAIT_PAYMENT_METHODS } from "./checkoutMock";

describe("what checkout can and cannot take", () => {
  /*
   * The flag used to say the whole checkout was a mock. Cash on delivery
   * (3.2.2) made that false — a cash order is real — so it now says the
   * narrower thing that is still true.
   */
  it("keeps the four card brands visible and non-functional", () => {
    expect(CARD_METHODS_ARE_DISPLAY_ONLY).toBe(true);
    expect(KUWAIT_PAYMENT_METHODS.map((method) => method.id)).toEqual([
      "knet",
      "visa",
      "mastercard",
      "google-pay",
    ]);
  });
});
