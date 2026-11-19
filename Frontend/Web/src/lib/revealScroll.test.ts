import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GLIDE_MS, REVEAL_GAP, glideFrame, glideProgress, revealTarget } from "./revealScroll";

describe("bringing a pressed department up to the top", () => {
  it("scrolls even when the list already starts on the upper part of the screen", () => {
    /*
     * The case the old rule did nothing for: a phone at the top of the page,
     * the first row's tile 180px down under a 58px header, its list starting
     * at about half the screen (under the 70% line it waited for).
     */
    const target = revealTarget({ scrollY: 0, tileTop: 180, covered: 58, maxScroll: 2000 });
    expect(target).toBe(180 - 58 - REVEAL_GAP);
    expect(target).toBeGreaterThan(0);
  });

  it("puts the tile just under the header, wherever the page is", () => {
    expect(revealTarget({ scrollY: 900, tileTop: 400, covered: 58, maxScroll: 3000 })).toBe(900 + 400 - 58 - REVEAL_GAP);
  });

  it("brings a tile half under the header back down into view", () => {
    expect(revealTarget({ scrollY: 900, tileTop: 30, covered: 58, maxScroll: 3000 })).toBe(900 + 30 - 58 - REVEAL_GAP);
  });

  it("never asks past where the page can go, nor above its top", () => {
    expect(revealTarget({ scrollY: 100, tileTop: 1200, covered: 58, maxScroll: 700 })).toBe(700);
    expect(revealTarget({ scrollY: 0, tileTop: 20, covered: 58, maxScroll: 700 })).toBe(0);
    expect(revealTarget({ scrollY: 0, tileTop: 400, covered: 58, maxScroll: -10 })).toBe(0);
  });

  it("eases from the start to the end of the glide", () => {
    expect(glideProgress(0)).toBe(0);
    expect(glideProgress(GLIDE_MS)).toBe(1);
    expect(glideProgress(GLIDE_MS * 2)).toBe(1);
    expect(glideProgress(GLIDE_MS / 2)).toBeGreaterThan(0.5);
    expect(glideProgress(10, 0)).toBe(1);
  });

  it("moves each frame toward where the tile is now", () => {
    expect(glideFrame(100, 500, 0)).toBe(100);
    expect(glideFrame(100, 500, 0.5)).toBe(300);
    expect(glideFrame(100, 500, 1)).toBe(500);
  });

  it("is what the Categories page does on every press, not only when the list starts low", () => {
    const page = readFileSync(fileURLToPath(new URL("../pages/Categories.tsx", import.meta.url)), "utf8");
    const from = page.indexOf("if (press?.slug === opened.slug)");
    expect(from).toBeGreaterThan(0);
    const pressed = page.slice(from);
    /* The press's branch glides before anything asks where the list starts. */
    expect(pressed.indexOf("glideTileIntoView(tile)")).toBeLessThan(pressed.indexOf("innerHeight * 0.7"));
  });
});
