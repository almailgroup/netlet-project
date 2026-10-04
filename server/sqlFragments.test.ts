/**
 * A raw `sql` fragment carrying `or` must bracket itself.
 *
 * Drizzle's `and(a, b)` joins its conditions with " and " and wraps the whole,
 * but not each one — so `and(scope, sql\`x or y\`)` reads "scope and x, or y",
 * and the scope stops applying to half the rows. That is how a vendor's
 * low-stock list came to show every other store's low variants. A fragment
 * that starts with "(" cannot be split that way, wherever it ends up.
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

/*
 * The template's own text with every `${…}` replaced by X. A regex stopping at
 * the next backtick cannot do this: a search fragment interpolates a template
 * literal of its own (`${`%${term}%`}`), the regex stopped at that inner
 * backtick, and the `or` after it was never seen — which is how a seller's
 * product search came to return every other store's products while this test
 * passed.
 */
function readTemplate(text: string, start: number): { body: string; end: number } {
  let body = "";
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") { body += text.slice(i, i + 2); i += 2; continue; }
    if (ch === "`") return { body, end: i + 1 };
    if (ch === "$" && text[i + 1] === "{") { body += "X"; i = skipExpression(text, i + 2); continue; }
    body += ch;
    i += 1;
  }
  return { body, end: i };
}

/** Past the `}` that closes an interpolation, stepping over strings and nested templates. */
function skipExpression(text: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === "`") { i = readTemplate(text, i + 1).end; continue; }
    if (ch === "'" || ch === '"') {
      i += 1;
      while (i < text.length && text[i] !== ch) i += text[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    i += 1;
  }
  return i;
}

function sqlFragments(text: string): string[] {
  const bodies: string[] = [];
  let at = text.indexOf("sql`");
  while (at !== -1) {
    const { body, end } = readTemplate(text, at + 4);
    bodies.push(body.trim());
    at = text.indexOf("sql`", end);
  }
  return bodies;
}

describe("raw SQL fragments", () => {
  it("are read whole, nested templates and all", () => {
    expect(sqlFragments("x = sql`lower(${a}) like ${`%${term}%`} or ${b} like ${`%${term}%`}`;")).toEqual(["lower(X) like X or X like X"]);
    expect(sqlFragments("sql`(${a} or ${b})` + sql`count(*)`")).toEqual(["(X or X)", "count(*)"]);
  });

  it("bracket any `or` they carry", () => {
    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      const text = readFileSync(file, "utf-8");
      for (const body of sqlFragments(text)) {
        if (/\sor\s/i.test(body) && !body.startsWith("(")) offenders.push(`${path.relative(ROOT, file)}: ${body.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
