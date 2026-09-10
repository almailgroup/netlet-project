import { describe, expect, it } from "vitest";
import { categorySlug } from "./browse";
import { DEPARTMENTS } from "./departments";

describe("departments", () => {
  // The bug this prevents: a seeded slug of "home-kitchen" while the client
  // links to "home-and-kitchen". Both look right in isolation; together the
  // department page is empty and nothing logs an error.
  it("stores the slug the client would generate from the name", () => {
    for (const department of DEPARTMENTS) {
      expect(categorySlug(department.name)).toBe(department.slug);
    }
  });

  it("has a translation for every department, not an English copy", () => {
    for (const department of DEPARTMENTS) {
      expect(department.nameAr.trim()).not.toBe("");
      expect(department.nameAr).not.toBe(department.name);
    }
  });

  it("has no duplicate slugs, which the unique index would reject at seed time", () => {
    const slugs = DEPARTMENTS.map(d => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("does not include All, which is the absence of a filter", () => {
    expect(DEPARTMENTS.some(d => d.slug === "all")).toBe(false);
  });
});
