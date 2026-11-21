/**
 * The wide header's glass at rest stops at the bar's foot.
 *
 * Its bend reaches 40px past the bar so the warp leaves no bites in the rim,
 * and at the top of the page those 40px are the department row: the navy App
 * Store badge under the cart was blurred and warped up into the bar as a blue
 * haze, which the owner reported from a screenshot. Measured at 1440 the
 * bar's foot strayed up to 47 colour steps from its own colour; with the bend
 * stopping at the foot at rest it strays 3. Once the page moves (`data-stuck`)
 * the bend reaches down again for what passes beneath, and the phone's search
 * sheet keeps its own rule.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../index.css"), "utf-8");

/** The body of every `@media (min-width: 1024px)` block, braces balanced. */
function wideBlocks(source: string): string[] {
  const blocks: string[] = [];
  const opener = /@media \(min-width: 1024px\)\s*\{/g;
  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    let depth = 1;
    let at = match.index + match[0].length;
    const start = at;
    while (depth > 0 && at < source.length) {
      if (source[at] === "{") depth++;
      else if (source[at] === "}") depth--;
      at++;
    }
    blocks.push(source.slice(start, at - 1));
  }
  return blocks;
}

describe("the wide header's glass at rest", () => {
  const blocks = wideBlocks(css);

  it("reads the stylesheet's wide-screen blocks", () => {
    /* A guard that finds nothing passes; count what it read. */
    expect(blocks.length).toBeGreaterThan(3);
  });

  it("stops the bend at the bar's foot while nothing passes under it", () => {
    const rest = blocks
      .map(block => /\.sticky-header:not\(\[data-stuck\]\):not\(\[data-search-open\]\)\s*>\s*\.glass-bar-surface\s*>\s*\.glass-bar-bend\s*\{([^}]*)\}/.exec(block)?.[1])
      .find(Boolean);
    expect(rest).toBeDefined();
    expect(rest).toMatch(/bottom:\s*0\s*;/);
  });

  it("still reaches past the bar once the page moves", () => {
    /* The base rule: the reach the rest rule takes back only at rest. */
    expect(css).toMatch(/\.glass-bar-bend\s*\{\s*display:\s*block;\s*inset:\s*-40px;/);
  });
});
