import { describe, expect, it } from "vitest";
import { TAB_ICON_COMMANDS, TAB_ICON_SIZE, TAB_ICON_STROKE, TAB_ICONS } from "./tabIcons";

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

  it("draws Deals as a red bag a little larger than the rest, the others in the bar's ink", () => {
    const deals = TAB_ICONS.deals;
    expect(deals.color?.ink).toMatch(/^#[0-9a-f]{6}$/);
    expect(deals.color?.deep).toMatch(/^#[0-9a-f]{6}$/);
    expect(deals.size).toBeGreaterThan(TAB_ICON_SIZE);
    expect(deals.size).toBeLessThanOrEqual(TAB_ICON_SIZE + 12);
    /* Its line looks as heavy on screen as the others'. */
    const onScreen = ((deals.stroke ?? TAB_ICON_STROKE) * (deals.size ?? TAB_ICON_SIZE)) / 24;
    expect(Math.abs(onScreen - (TAB_ICON_STROKE * TAB_ICON_SIZE) / 24)).toBeLessThan(0.35);
    /* Chosen, the percent is cut out of the filled bag. */
    expect(deals.filled.some(path => path.knockout)).toBe(true);
    for (const [name, drawing] of Object.entries(TAB_ICONS)) {
      if (name === "deals") continue;
      expect(drawing.color, name).toBeUndefined();
      expect(drawing.size, name).toBeUndefined();
      expect(drawing.stroke, name).toBeUndefined();
      expect([...drawing.outline, ...drawing.filled].some(path => path.deep), name).toBe(false);
    }
  });
});
