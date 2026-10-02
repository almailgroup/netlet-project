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

describe("raw SQL fragments", () => {
  it("bracket any `or` they carry", () => {
    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      const text = readFileSync(file, "utf-8");
      for (const match of text.matchAll(/sql`([^`]*)`/g)) {
        const body = match[1].replace(/\$\{[^}]*\}/g, "X").trim();
        if (/\sor\s/i.test(body) && !body.startsWith("(")) offenders.push(`${path.relative(ROOT, file)}: ${body.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
