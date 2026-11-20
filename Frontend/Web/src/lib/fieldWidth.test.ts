/**
 * A width written after the portal's field class does nothing. `fieldClass`
 * carries `w-full`, and Tailwind writes `w-full` after every numbered width
 * and `w-auto`, so `${fieldClass} w-16` is a full-width box: the bundle
 * builder's quantity box took a phone's row and left the item's name and
 * price a column one letter wide. A narrower box says `max-w-*`, which holds
 * beside `w-full`; a width at a breakpoint (`sm:w-56`) is written later and
 * holds too.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

/** Every class written in the same template as `${fieldClass}`. */
function widthsAfterField(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/`\$\{fieldClass\}([^`]*)`/g)) {
    for (const token of match[1].trim().split(/\s+/)) {
      if (/^w-/.test(token) && token !== "w-full") found.push(token);
    }
  }
  return found;
}

describe("a width after the portal's field class", () => {
  it("is caught in a template", () => {
    expect(widthsAfterField("className={`${fieldClass} h-9 w-16 px-2`}")).toEqual(["w-16"]);
    expect(widthsAfterField("className={`${fieldClass} h-9 max-w-24 sm:w-56`}")).toEqual([]);
    expect(widthsAfterField("className={`${fieldClass} w-auto`}")).toEqual(["w-auto"]);
  });

  it("is never one that does nothing", () => {
    const read = files(SRC);
    const wrong: string[] = [];
    let templates = 0;
    for (const file of read) {
      const source = readFileSync(file, "utf-8");
      templates += [...source.matchAll(/`\$\{fieldClass\}/g)].length;
      for (const token of widthsAfterField(source)) wrong.push(`${path.relative(SRC, file)}: ${token}`);
    }
    /* A guard that reads nothing passes: it read the portal's forms. */
    expect(templates).toBeGreaterThan(20);
    expect(wrong).toEqual([]);
  });
});
