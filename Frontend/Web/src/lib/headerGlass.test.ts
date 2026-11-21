/**
 * The shop's glass samples only what is behind its own surface.
 *
 * It was warped by an SVG turbulence displacement (`#netlet-glass`) and its
 * blurring layer reached 40px past the surface so the warp left no bites in
 * the rim. Photographed over the shop, that warp was what made the glass look
 * dirty: it pulled a card's edge up beside the logo as a grey smudge, broke
 * the hero's colours into patches, and blurred the department row's navy App
 * Store badge up into the bar as a blue haze, which the owner reported from a
 * screenshot. The owner asked for the glass to be cleaner, and it is a plain
 * blur and a tint now, with the light on the face.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = path.resolve(import.meta.dirname, "..");
const css = readFileSync(path.join(src, "index.css"), "utf-8");

/** Every rule whose selector names the glass's blurring layer, as `[selector, body]`. */
function bendRules(source: string): [string, string][] {
  return [...source.matchAll(/([^{}]*\.glass-bar-bend[^{}]*)\{([^}]*)\}/g)].map(match => [match[1].trim(), match[2]]);
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(tsx?|css)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [readFileSync(full, "utf-8")] : [];
  });
}

describe("the shop's glass", () => {
  const rules = bendRules(css);

  it("reads the glass's rules", () => {
    /* A guard that finds nothing passes; count what it read. */
    expect(rules.length).toBeGreaterThanOrEqual(2);
  });

  it("never reaches past its own surface", () => {
    const reaching = rules.filter(([, body]) => /\binset:\s*-|\b(?:top|bottom|left|right):\s*-/.test(body));
    expect(reaching).toEqual([]);
  });

  it("is never warped by a filter", () => {
    expect(rules.filter(([, body]) => /\bfilter:\s*url\(/.test(body.replace(/backdrop-filter:[^;]*;/g, "")))).toEqual([]);
    expect(sources(src).some(file => file.includes("netlet-glass"))).toBe(false);
  });

  it("blurs what passes beneath it", () => {
    expect(rules.some(([, body]) => /(?:^|[^-])backdrop-filter:\s*blur\(/.test(body))).toBe(true);
  });
});
