/**
 * The requirements table has to agree with itself.
 *
 * Both the grand total and every section heading were hand-maintained, and
 * both drifted: the first pass stated 12 built and 12 partial while the rows
 * said 11 and 11 — an off-by-one in each direction that cancelled out in the
 * total, so nothing looked wrong until somebody counted. Landing a requirement
 * then incremented a number that was already incorrect.
 *
 * This is the same failure `QueryGate` was built to stop, applied to a
 * document: a status board that misreports its own status is worse than none,
 * because it reads as working.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error — a plain .mjs helper, shared with the CLI that prints it.
import { tally, statedTotals } from "./check-requirements.mjs";

const DOC = path.resolve(import.meta.dirname, "../../docs/REQUIREMENTS.md");
const markdown = readFileSync(DOC, "utf-8");

describe("docs/REQUIREMENTS.md", () => {
  it("accounts for all 77 requirements exactly once", () => {
    expect(tally(markdown).grand).toBe(77);
  });

  it("has no row whose status cannot be read", () => {
    expect(tally(markdown).unclassified).toEqual([]);
  });

  it("states the totals the rows actually add up to", () => {
    const { totals } = tally(markdown);
    expect(statedTotals(markdown)).toEqual({
      Built: totals.built,
      Partial: totals.partial,
      "Designed, not wired": totals.drawn,
      "Not applicable": totals.na,
      "Not started": totals.absent,
    });
  });

  /* A section heading that disagrees with its own rows is the drift that
     started this, so every tally in a heading is checked against them. */
  it("has section headings that match their own rows", () => {
    const { bySection } = tally(markdown);
    const wrong: string[] = [];

    for (const line of markdown.split("\n")) {
      const heading = /^## ([\d.]+)[^—]*—(.+)$/.exec(line);
      if (!heading) continue;
      const counts = bySection.get(heading[1].replace(/\.$/, ""));
      if (!counts) continue;

      for (const [word, actual] of [
        ["built", counts.built], ["partial", counts.partial],
        ["drawn", counts.drawn], ["absent", counts.absent],
      ] as const) {
        const stated = new RegExp(`(\\d+)\\s+${word}`).exec(heading[2]);
        if (stated && Number(stated[1]) !== actual) {
          wrong.push(`${heading[1]}: says ${stated[1]} ${word}, rows say ${actual}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
