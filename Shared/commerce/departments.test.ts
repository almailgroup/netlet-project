import { describe, expect, it } from "vitest";
import { categorySlug } from "./browse.js";
import { ALL_DEPARTMENTS, DEPARTMENT_ICONS, DEPARTMENTS, departmentByName, departmentIcon } from "./departments.js";

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

  /*
   * The bug this prevents is the one that was shipped: the home page chose a
   * department's icon by its index in the array, through a nested ternary, so
   * Style drew `ArrowDownRight` and reordering the list reassigned every
   * picture. Binding the icon to the department is the whole fix, and this is
   * what says it stayed bound.
   */
  it("gives every department an icon, and never the merchant fallback", () => {
    for (const department of DEPARTMENTS) {
      expect(DEPARTMENT_ICONS).toContain(department.icon);
      expect(department.icon).not.toBe("tag");
    }
  });

  it("does not let two departments share a picture", () => {
    const icons = DEPARTMENTS.map(d => d.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("resolves an icon for a name in any casing, and for All", () => {
    expect(departmentIcon("Electronics")).toBe("plug");
    expect(departmentIcon("  electronics  ")).toBe("plug");
    expect(departmentIcon(ALL_DEPARTMENTS.query)).toBe("grid");
    expect(departmentIcon("all")).toBe("grid");
  });

  /*
   * The home rail lists NetLet's departments *and* every product type a
   * merchant has invented. Guessing a picture for one of those is how a pet
   * shop ends up under a saucepan, so the answer is a label tag: it says
   * "department" and claims nothing more.
   */
  it("answers for a department NetLet has never heard of", () => {
    expect(departmentIcon("Pet supplies")).toBe("tag");
    expect(departmentByName("Pet supplies")).toBeNull();
  });

  it("keeps a tint and a translated label on every department", () => {
    for (const department of DEPARTMENTS) {
      expect(department.tint).toMatch(/^#[0-9a-f]{6}$/);
      expect(department.label.startsWith("category.")).toBe(true);
    }
  });
});
