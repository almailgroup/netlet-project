/**
 * An ordering by `position` ends on the id.
 *
 * Every variant, photo, add-on and bundle item a seller creates sits at
 * position 0 until something reorders it, so `position` alone is a tie on
 * every row — and Postgres orders ties freely. On a real database it handed
 * back the row it had just updated last, so editing the M of a shirt put its
 * sizes in the order S, L, XL, M. PGlite answers the same query through the
 * index and keeps the order either way, which is why this reads the source
 * rather than a database: no test against PGlite could fail on it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
  });
}

/** The argument list of each `.orderBy(`, read to its closing bracket. */
function orderings(text: string): string[] {
  const found: string[] = [];
  let at = text.indexOf(".orderBy(");
  while (at !== -1) {
    let depth = 0;
    let i = at + ".orderBy".length;
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) break;
    }
    found.push(text.slice(at + ".orderBy(".length, i));
    at = text.indexOf(".orderBy(", i);
  }
  return found;
}

describe("orderings by position", () => {
  it("reads a nested call whole", () => {
    expect(orderings("x.orderBy(asc(a.position), asc(a.id)).limit(1)")).toEqual(["asc(a.position), asc(a.id)"]);
  });

  it("end on the id everywhere in server/", () => {
    const offenders = sources(ROOT).flatMap(file =>
      orderings(readFileSync(file, "utf8"))
        .filter(args => /\.position\b/.test(args) && !/\.id\b/.test(args) && !/\.name\b/.test(args))
        .map(args => `${path.relative(ROOT, file)}: orderBy(${args})`));
    expect(offenders).toEqual([]);
  });
});
