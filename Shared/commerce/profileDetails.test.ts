import { describe, expect, it } from "vitest";
import {
  birthdayProblem,
  COMMON_NATIONALITIES,
  composeName,
  COUNTRY_CODES,
  isCountryCode,
  nameProblem,
  profilePhone,
  splitName,
} from "./profileDetails.js";

describe("the profile's details", () => {
  it("offers a display name back as a first word and the rest", () => {
    expect(splitName("Noura Al-Sabah")).toEqual({ first: "Noura", last: "Al-Sabah" });
    expect(splitName("  Mohammed  Abdullah Al-Mutairi ")).toEqual({ first: "Mohammed", last: "Abdullah Al-Mutairi" });
    expect(splitName("Fahad")).toEqual({ first: "Fahad", last: "" });
    expect(splitName(null)).toEqual({ first: "", last: "" });
    expect(composeName(" Abdul Rahman ", "Al-Ali")).toBe("Abdul Rahman Al-Ali");
  });

  it("needs both names and keeps each short", () => {
    expect(nameProblem("Noura", "")).toBe("profile.nameRequired");
    expect(nameProblem("", "Al-Sabah")).toBe("profile.nameRequired");
    expect(nameProblem("N".repeat(61), "Al-Sabah")).toBe("profile.nameTooLong");
    expect(nameProblem("Noura", "Al-Sabah")).toBeNull();
  });

  it("stores a phone as the wishlist number is stored, Arabic digits included", () => {
    expect(profilePhone("٥٠١٢ ٣٤٥٦")).toEqual({ phone: "+96550123456" });
    expect(profilePhone("123")).toEqual({ problem: "wishlist.phoneInvalid" });
  });

  it("takes a real birthday no later than today in Kuwait", () => {
    expect(birthdayProblem("1990-05-17", "2026-10-27")).toBeNull();
    expect(birthdayProblem("2026-10-27", "2026-10-27")).toBeNull();
    expect(birthdayProblem("2026-10-28", "2026-10-27")).toBe("profile.birthdayInvalid");
    expect(birthdayProblem("1899-12-31", "2026-10-27")).toBe("profile.birthdayInvalid");
    expect(birthdayProblem("2023-02-29", "2026-10-27")).toBe("profile.birthdayInvalid");
    expect(birthdayProblem("2024-02-29", "2026-10-27")).toBeNull();
    expect(birthdayProblem("17/05/1990", "2026-10-27")).toBe("profile.birthdayInvalid");
  });

  it("knows every country once, and draws its chips from them", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const code of COMMON_NATIONALITIES) expect(isCountryCode(code)).toBe(true);
    expect(isCountryCode("KW")).toBe(true);
    expect(isCountryCode("EU")).toBe(false);
    expect(isCountryCode("kw")).toBe(false);
  });
});
