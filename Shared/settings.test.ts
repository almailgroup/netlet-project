import { describe, expect, it } from "vitest";
import { normaliseSetting, resolveSettings, SETTINGS } from "./settings.js";

describe("the administrator's numbers", () => {
  it("takes a percentage inside the range, to two decimals", () => {
    expect(normaliseSetting("referral.productPercent", "20")).toBe("20.00");
    expect(normaliseSetting("referral.productPercent", " 12.5 ")).toBe("12.50");
    expect(normaliseSetting("referral.productPercent", "0")).toBe("0.00");
    expect(normaliseSetting("referral.productPercent", "50")).toBe("50.00");
  });

  it("refuses anything outside it, or not a percentage", () => {
    for (const value of ["50.01", "-1", "1.234", "abc", "", "1e2", "20%"]) {
      expect(normaliseSetting("referral.invitePercent", value)).toBeNull();
    }
  });

  /* Both rates together can never exceed what NetLet took on a line. */
  it("keeps the two referral rates within NetLet's commission between them", () => {
    expect(SETTINGS["referral.productPercent"].max + SETTINGS["referral.invitePercent"].max).toBeLessThanOrEqual(100);
  });

  it("reads an unknown key as nothing and an unreadable value as its default", () => {
    expect(resolveSettings([{ key: "referral.productPercent", value: "nonsense" }, { key: "other", value: "1" }])).toEqual({
      "referral.productPercent": "20.00",
      "referral.invitePercent": "10.00",
    });
    expect(resolveSettings([{ key: "referral.invitePercent", value: "7.5" }])["referral.invitePercent"]).toBe("7.50");
  });
});
