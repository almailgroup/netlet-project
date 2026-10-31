import { describe, expect, it } from "vitest";
import { DISPLAY_CURRENCIES, REFERENCE_RATES, convertFromDinars, isDisplayCurrency, minorDigits, ratesFromFeed } from "./currency";

describe("display currency", () => {
  it("offers the dinar first, then the owner's list and every Gulf currency", () => {
    expect(DISPLAY_CURRENCIES[0]).toBe("KWD");
    for (const code of ["USD", "GBP", "EUR", "SAR", "QAR", "AED", "BHD", "OMR"]) expect(isDisplayCurrency(code)).toBe(true);
    expect(isDisplayCurrency("JPY")).toBe(false);
    expect(isDisplayCurrency(undefined)).toBe(false);
  });

  it("keeps the Gulf's pegs to the dollar in the reference", () => {
    const usd = REFERENCE_RATES.USD;
    expect(REFERENCE_RATES.SAR / usd).toBeCloseTo(3.75, 2);
    expect(REFERENCE_RATES.QAR / usd).toBeCloseTo(3.64, 2);
    expect(REFERENCE_RATES.AED / usd).toBeCloseTo(3.6725, 2);
    expect(REFERENCE_RATES.BHD / usd).toBeCloseTo(0.376, 3);
    expect(REFERENCE_RATES.OMR / usd).toBeCloseTo(0.3845, 3);
  });

  it("converts once and rounds to the currency's own minor unit", () => {
    expect(convertFromDinars(10, "KWD")).toBe(10);
    expect(convertFromDinars(10, "USD", { USD: 3.2567 })).toBe(32.57);
    expect(convertFromDinars(24.375, "BHD", { BHD: 1.2258 })).toBe(29.879);
    expect(minorDigits("OMR")).toBe(3);
    expect(minorDigits("EUR")).toBe(2);
  });

  it("shows dinars rather than inventing a figure with no rate", () => {
    expect(convertFromDinars(5, "GBP", {})).toBe(5);
  });

  it("reads a dinar feed and refuses one that is not", () => {
    const rates = ratesFromFeed({ result: "success", base_code: "KWD", rates: { USD: 3.25, EUR: 2.9, JPY: 500 } });
    expect(rates?.USD).toBe(3.25);
    expect(rates?.EUR).toBe(2.9);
    expect(rates?.GBP).toBe(REFERENCE_RATES.GBP);
    expect(ratesFromFeed({ result: "success", base_code: "USD", rates: { KWD: 0.31 } })).toBeNull();
    expect(ratesFromFeed({ result: "error" })).toBeNull();
    expect(ratesFromFeed("nonsense")).toBeNull();
  });

  it("keeps the reference for a rate far from it, so a bad feed cannot misprice every card", () => {
    const rates = ratesFromFeed({ result: "success", base_code: "KWD", rates: { USD: 325, GBP: 2.43 } });
    expect(rates?.USD).toBe(REFERENCE_RATES.USD);
    expect(rates?.GBP).toBe(2.43);
    expect(ratesFromFeed({ base_code: "KWD", rates: { USD: 0 } })).toBeNull();
  });
});
