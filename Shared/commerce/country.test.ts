import { describe, expect, it } from "vitest";
import { flagOf, HOME_COUNTRY, SHOP_COUNTRIES } from "./country.js";

describe("the shop's countries", () => {
  it("runs in Kuwait alone, with the rest of the Gulf to come", () => {
    expect(SHOP_COUNTRIES.filter(country => country.open).map(country => country.code)).toEqual([HOME_COUNTRY]);
    expect(SHOP_COUNTRIES.map(country => country.code)).toEqual(["KW", "SA", "AE", "QA", "BH", "OM"]);
  });
  it("draws a flag from the code", () => {
    expect(flagOf("KW")).toBe("🇰🇼");
    expect(flagOf("kw")).toBe("");
  });
});
