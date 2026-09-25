/**
 * Keeps `docs/REQUIREMENTS.md` honest about its own arithmetic.
 *
 * The file states a total at the top and a tally in every section heading, and
 * both were hand-maintained — so both drifted. The first pass claimed 12 built
 * and 12 partial when the rows said 11 and 11, an off-by-one in each direction
 * that cancelled out in the total and therefore looked correct. Landing a
 * requirement then incremented the wrong number.
 *
 * A status table that misreports its own status is worse than no table, for
 * exactly the reason `QueryGate` exists: it reads as working. So the counts are
 * derived from the rows here, and `requirements.test.ts` fails when the written
 * numbers disagree.
 *
 * Run directly to print the truth:  node scripts/check-requirements.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/REQUIREMENTS.md");

/** Requirements that are written as prose rather than as a table row. */
export const PROSE_SECTIONS = {
  "3.5": 3,
  "3.7": 2,
  "3.8": 2,
};



/** Which status a table row carries. Null when the line is not a row. */
function statusOf(line) {
  if (!line.startsWith("| ") || line.split("|").length < 5) return null;
  const cells = line.replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  // Skip the header and the `|---|` separator.
  if (cells[0] === "#" || cells[0] === "" || /^[-: ]+$/.test(cells[0])) return null;

  if (line.includes("**Built**")) return "built";
  if (line.includes("**Partial**")) return "partial";
  if (/not wired/i.test(line)) return "drawn";
  if (line.includes("| n/a |")) return "na";
  if (line.includes("Not started")) return "absent";
  return "unclassified";
}

/** Every requirement the document accounts for, by section and by status. */
export function tally(markdown = readFileSync(DOC, "utf-8")) {
  const totals = { built: 0, partial: 0, drawn: 0, na: 0, absent: 0 };
  const bySection = new Map();
  const unclassified = [];

  let section = "";
  for (const line of markdown.split("\n")) {
    const heading = /^## ([\d.]+)/.exec(line);
    if (heading) section = heading[1].replace(/\.$/, "");

    const status = statusOf(line);
    if (!status) continue;
    if (status === "unclassified") { unclassified.push(line.slice(0, 80)); continue; }

    totals[status] += 1;
    const current = bySection.get(section) ?? { built: 0, partial: 0, drawn: 0, na: 0, absent: 0 };
    current[status] += 1;
    bySection.set(section, current);
  }

  // The prose sections are all "not started" and have no rows to count.
  for (const [key, count] of Object.entries(PROSE_SECTIONS)) {
    totals.absent += count;
    bySection.set(key, { built: 0, partial: 0, drawn: 0, na: 0, absent: count });
  }

  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  return { totals, bySection, unclassified, grand };
}

/** What the document *says* in its summary block, for comparison with the rows. */
export function statedTotals(markdown = readFileSync(DOC, "utf-8")) {
  const stated = {};
  for (const [, label, value] of markdown.matchAll(/^\| (Built|Partial|Designed, not wired|Not applicable|Not started) \| (\d+) \|$/gm)) {
    stated[label] = Number(value);
  }
  return stated;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const { totals, bySection, unclassified, grand } = tally();
  console.log("counted from the rows:", totals, `→ ${grand} requirements`);
  for (const [section, counts] of [...bySection].sort()) {
    console.log(`  ${section.padEnd(4)} built ${counts.built}  partial ${counts.partial}  drawn ${counts.drawn}  n/a ${counts.na}  absent ${counts.absent}`);
  }
  if (unclassified.length) {
    console.error("\nrows with no recognisable status:");
    for (const row of unclassified) console.error("  ", row);
    process.exit(1);
  }
  console.log("\nstated in the summary:", statedTotals());
}
