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

const IOS = path.resolve(import.meta.dirname, "..");
/** The app's own sources, the code it shares with its widget extension, and the extension's. */
const APP_FOLDERS = ["NetLet", "NetLetShared", "NetLetWidgets"].map((folder) => path.join(IOS, folder));

function swiftSources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : swiftSources(full);
    return entry.name.endsWith(".swift") ? [{ file: path.relative(IOS, full), text: readFileSync(full, "utf-8") }] : [];
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
    const sources = APP_FOLDERS.flatMap((folder) => swiftSources(folder));
    const offenders = sources.flatMap(({ file, text }) => phoneZoneDates(text).map((line) => `${file}:${line}`));
    // A scan that finds nothing passes: it has read the app.
    expect(sources.length).toBeGreaterThan(200);
    expect(offenders).toEqual([]);
  });
});

/* A calendar's chosen day is white digits on the picker's tint, and the
   root's tint is `Brand.navy`, which the dark makes white — so a date picker
   that took it drew today, chosen, as white on white. Every `DatePicker`
   wears `Brand.control` among its own modifiers (a switch takes it from
   `NetLetSwitchStyle`, which the root and every sheet set). */
/** The lines where a `DatePicker(` starts whose own modifiers never name `.tint(Brand.control)`. */
export function untintedDatePickers(text: string): number[] {
  const lines = text.split("\n");
  return lines.flatMap((line, index) => {
    const at = line.indexOf("DatePicker(");
    if (at < 0 || /^\s*\/\//.test(line)) return [];
    const indent = line.length - line.trimStart().length;
    // The statement runs until a line at or left of the picker's own indent
    // that is not one of its modifiers or the close of its arguments.
    for (let next = index + 1; next < lines.length; next++) {
      const code = lines[next];
      if (code.includes(".tint(Brand.control)")) return [];
      const trimmed = code.trimStart();
      if (trimmed === "") return [index + 1];
      const left = code.length - trimmed.length;
      if (left <= indent && !trimmed.startsWith(".") && !trimmed.startsWith(")")) return [index + 1];
    }
    return [index + 1];
  });
}

describe("a date picker in the app", () => {
  it("knows a picker with the control's colour from one without", () => {
    expect(untintedDatePickers(`    DatePicker("x", selection: $d)\n        .labelsHidden()\n        .tint(Brand.control)\n    Text("y")`)).toEqual([]);
    expect(untintedDatePickers(`    DatePicker("x", selection: $d)\n        .labelsHidden()\n    DatePicker("z", selection: $e)\n        .tint(Brand.control)`)).toEqual([1]);
    expect(untintedDatePickers(`    DatePicker(\n        "x",\n        selection: $d\n    )\n    .tint(Brand.control)`)).toEqual([]);
  });

  it("always wears Brand.control, so a chosen day is never white on white", () => {
    const sources = APP_FOLDERS.flatMap((folder) => swiftSources(folder));
    const pickers = sources.reduce((count, { text }) => count + (text.match(/DatePicker\(/g)?.length ?? 0), 0);
    const offenders = sources.flatMap(({ file, text }) => untintedDatePickers(text).map((line) => `${file}:${line}`));
    // A scan that finds nothing passes: it has read the pickers.
    expect(pickers).toBeGreaterThanOrEqual(13);
    expect(offenders).toEqual([]);
  });
});
