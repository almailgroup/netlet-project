import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";

describe("formatMoney", () => {
  // The dinar has three decimal places. Capping at two rounds a real price on
  // screen while the cart charges the true amount.
  it("keeps all three dinar decimals", () => {
    expect(formatMoney({ amount: "24.375", currencyCode: "KWD" })).toContain("24.375");
  });

  it("pads a two-decimal price to the dinar's three", () => {
    expect(formatMoney({ amount: "129.50", currencyCode: "KWD" })).toContain("129.500");
  });

  it("renders a whole amount without decimals", () => {
    expect(formatMoney({ amount: "129", currencyCode: "KWD" })).toContain("129");
    expect(formatMoney({ amount: "129", currencyCode: "KWD" })).not.toContain("129.000");
  });

  it("still uses two decimals for a two-decimal currency", () => {
    expect(formatMoney({ amount: "12.34", currencyCode: "USD" })).toContain("12.34");
  });

  it("renders Arabic with the dinar symbol and Western digits", () => {
    const formatted = formatMoney({ amount: "24.375", currencyCode: "KWD" }, { locale: "ar" });
    expect(formatted).toContain("24.375");
    expect(formatted).toContain("د.ك");
  });

  it("returns a dash rather than NaN for an unparseable amount", () => {
    expect(formatMoney({ amount: "not a number", currencyCode: "KWD" })).toBe("—");
  });
});

it("reads a bare amount as dinars, the shop's one currency", () => {
  expect(formatMoney("2.000", { locale: "en" })).toContain("KWD");
});
