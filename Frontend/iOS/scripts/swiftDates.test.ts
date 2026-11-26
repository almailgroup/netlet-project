import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Every date the app draws is a Kuwaiti day (`OrderWording.date`,
   `dateTime`, `day`, the web's `SHOP_TIME_ZONE`), because the shop's days are
   Kuwait's — a code's last day, a release date, when a key was last used.
   SwiftUI's own `date.formatted(…)` and `Text(date, style:)` write it in the
   phone's zone instead, so the Face ID card's "Last used" read as the day
   before on a phone set west of Greenwich. A formatter the app builds itself
   says its zone; these never can. */
const PHONE_ZONE = [
  /\.formatted\(\s*Date\.FormatStyle/,
  /\.formatted\(\s*date:/,
  /\.formatted\(\s*\.dateTime/,
  /Text\([^)]*,\s*style:\s*\.(date|time|relative|offset)\)/,
  /Text\([^)]*,\s*format:\s*\.dateTime/,
];

const APP = path.resolve(import.meta.dirname, "..", "NetLet");

function swiftSources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : swiftSources(full);
    return entry.name.endsWith(".swift") ? [{ file: path.relative(APP, full), text: readFileSync(full, "utf-8") }] : [];
  });
}

/** The lines of a file that format a date in the phone's own zone, comments left out. */
export function phoneZoneDates(text: string): number[] {
  return text.split("\n").flatMap((line, index) => {
    const code = line.replace(/\/\/.*$/, "");
    return PHONE_ZONE.some((shape) => shape.test(code)) ? [index + 1] : [];
  });
}

describe("a date in the app", () => {
  it("knows the shapes that write the phone's zone", () => {
    expect(phoneZoneDates(`let day = at.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted))`)).toEqual([1]);
    expect(phoneZoneDates(`Text(when, style: .date)`)).toEqual([1]);
    expect(phoneZoneDates(`x.formatted(date: .numeric, time: .omitted)`)).toEqual([1]);
    expect(phoneZoneDates(`// at.formatted(.dateTime)\nOrderWording.date(at, language: l)`)).toEqual([]);
    expect(phoneZoneDates(`price.formatted(.number)`)).toEqual([]);
  });

  it("is never drawn in the phone's own zone", () => {
    const sources = swiftSources(APP);
    const offenders = sources.flatMap(({ file, text }) => phoneZoneDates(text).map((line) => `${file}:${line}`));
    // A scan that finds nothing passes: it has read the app.
    expect(sources.length).toBeGreaterThan(200);
    expect(offenders).toEqual([]);
  });
});
