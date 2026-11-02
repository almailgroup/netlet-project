import { describe, expect, it } from "vitest";
import { TAB_ICON_COMMANDS, TAB_ICONS } from "./tabIcons";

describe("the tab bar's icons", () => {
  it("draws every tab in both forms, with only the commands the app reads", () => {
    expect(Object.keys(TAB_ICONS).sort()).toEqual(["cart", "categories", "deals", "home", "profile"]);
    for (const [name, drawing] of Object.entries(TAB_ICONS)) {
      for (const form of [drawing.outline, drawing.filled]) {
        expect(form.length, name).toBeGreaterThan(0);
        for (const path of form) {
          expect(path.d, `${name}: ${path.d}`).toMatch(TAB_ICON_COMMANDS);
          expect(path.d.trim().startsWith("M"), name).toBe(true);
        }
      }
    }
  });

  it("keeps every point inside the 24 grid, with room for the line", () => {
    for (const drawing of Object.values(TAB_ICONS)) {
      for (const path of [...drawing.outline, ...drawing.filled]) {
        const numbers = (path.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
        for (const value of numbers) {
          expect(value).toBeGreaterThanOrEqual(1);
          expect(value).toBeLessThanOrEqual(23);
        }
      }
    }
  });

  it("fills the chosen tab and outlines the rest", () => {
    for (const drawing of Object.values(TAB_ICONS)) {
      expect(drawing.outline.some(path => path.mode === "stroke")).toBe(true);
      expect(drawing.filled.some(path => path.mode === "both" || path.mode === "fill")).toBe(true);
    }
  });
});
