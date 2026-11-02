import { describe, expect, it } from "vitest";
import { en, ar } from "../i18n/dictionary.js";
import { foldTag, hijriMonthDay, inWindow, isOccasionProduct, kuwaitMonthDay, OCCASIONS, occasionFromSlug, occasionsOn, productsForOccasion } from "./occasions.js";

const on = (iso: string) => occasionsOn(new Date(iso)).map(occasion => occasion.slug);

describe("the occasions' calendar", () => {
  it("names every occasion in both languages", () => {
    for (const occasion of OCCASIONS) {
      expect(en[occasion.label]).toBeTruthy();
      expect(ar[occasion.label]).toBeTruthy();
    }
    expect(new Set(OCCASIONS.map(o => o.slug)).size).toBe(OCCASIONS.length);
  });

  it("reads the Umm al-Qura calendar", () => {
    /* 1 Ramadan 1447 is 18 February 2026, 1 Shawwal 20 March, 1 Dhu al-Hijja 18 May. */
    expect(hijriMonthDay(new Date("2026-03-01T09:00:00Z"))?.[0]).toBe(9);
    expect(hijriMonthDay(new Date("2026-03-22T09:00:00Z"))?.[0]).toBe(10);
    expect(hijriMonthDay(new Date("2026-05-24T09:00:00Z"))?.[0]).toBe(12);
  });

  it("is on for the fixed dates, and wraps the year's end", () => {
    expect(on("2026-08-20T09:00:00Z")).toEqual(["back-to-school"]);
    expect(on("2026-07-01T09:00:00Z")).toEqual(["summer"]);
    expect(on("2026-10-20T09:00:00Z")).toEqual(["halloween"]);
    expect(on("2026-12-25T09:00:00Z")).toEqual(["winter", "new-year"]);
    expect(on("2026-01-05T09:00:00Z")).toEqual(["winter", "new-year"]);
    expect(on("2026-01-20T09:00:00Z")).toEqual(["winter"]);
    expect(on("2026-03-10T09:00:00Z")).toContain("mothers-day");
    expect(on("2026-11-02T09:00:00Z")).toEqual([]);
    expect(inWindow([12, 20], { from: [12, 15], to: [1, 7] })).toBe(true);
    expect(inWindow([1, 8], { from: [12, 15], to: [1, 7] })).toBe(false);
  });

  it("moves with the Hijri calendar for Ramadan and the Eids", () => {
    expect(on("2026-02-20T09:00:00Z")).toEqual(["ramadan", "national-day"]);
    expect(on("2026-03-01T09:00:00Z")).toEqual(["ramadan"]);
    expect(on("2026-03-22T09:00:00Z")).toEqual(["eid-al-fitr"]);
    expect(on("2026-05-24T09:00:00Z")).toEqual(["eid-al-adha"]);
  });

  /* The shop's days are Kuwaiti days: at 01:00 in Kuwait the window has
     opened, though it is still the day before in UTC. */
  it("counts the day in Kuwait", () => {
    expect(kuwaitMonthDay(new Date("2026-08-10T22:00:00Z"))).toEqual([8, 11]);
    expect(on("2026-08-10T22:00:00Z")).toEqual(["back-to-school"]);
    expect(on("2026-08-10T20:00:00Z")).toEqual(["summer"]);
  });
});

describe("a product on an occasion", () => {
  const school = occasionFromSlug("back-to-school")!;
  const tagged = (...tags: string[]) => ({ tags });

  it("is tagged with any of its words, in either language, however they are typed", () => {
    for (const tag of ["Back to School", "back-to-school", "BACK_TO_SCHOOL", "school", "العودة إلى المدارس", "العودة الى المدارس", "مدرسة", "المدرسه"]) {
      expect(isOccasionProduct(tagged("sale", tag), school)).toBe(true);
    }
    expect(isOccasionProduct(tagged("summer", "sale"), school)).toBe(false);
    expect(isOccasionProduct(tagged(), school)).toBe(false);
  });

  it("folds a tag to what it means", () => {
    expect(foldTag("Back-to-School!")).toBe("backtoschool");
    expect(foldTag("العودة إلى المدارس")).toBe(foldTag("العودة الى المدارس"));
    expect(foldTag("رَمَضان")).toBe("رمضان");
  });

  it("keeps the shelf's order and knows no slug it was not given", () => {
    const products = [tagged("school"), tagged("winter"), tagged("Back to school")];
    expect(productsForOccasion(products, school)).toEqual([products[0], products[2]]);
    expect(occasionFromSlug("prom-night")).toBeNull();
    expect(occasionFromSlug(null)).toBeNull();
  });
});
