import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DICTIONARY, plural, translate } from "./i18n.js";
import type { Key } from "./i18n.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sources(full);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") && name !== "i18n.ts" ? [full] : [];
  });
}

describe("the dictionary", () => {
  const keys = Object.keys(DICTIONARY.en) as Key[];

  it("says every English sentence in Arabic, with the same placeholders", () => {
    for (const key of keys) {
      const ar = DICTIONARY.ar[key];
      expect(ar, key).toBeTruthy();
      expect(placeholders(ar), key).toEqual(placeholders(DICTIONARY.en[key]));
    }
  });

  it("has no Arabic entry still in English", () => {
    const allowed = new Set<Key>(["site.name", "track.placeholder", "footer.rights", "lang.other"]);
    const copies = keys.filter(key => !allowed.has(key) && DICTIONARY.ar[key] === DICTIONARY.en[key]);
    expect(copies).toEqual([]);
  });

  it("has no key the site never asks for", () => {
    const code = ["src", "server", "shared"].flatMap(dir => sources(path.join(ROOT, dir))).map(file => readFileSync(file, "utf8")).join("\n");
    /* Keys built from a status or a field name are asked for by their prefix. */
    const built = ["status.", "say.", "step."];
    const unused = keys.filter(key => !code.includes(`"${key}"`) && !built.some(prefix => key.startsWith(prefix)));
    expect(unused).toEqual([]);
  });

  it("fills placeholders and counts in Arabic's bands", () => {
    expect(translate("en", "result.expected", { day: "Monday" })).toBe("Expected Monday");
    expect(plural("en", "pieces", 1)).toBe("1 piece");
    expect(plural("en", "pieces", 3)).toBe("3 pieces");
    expect(plural("ar", "pieces", 1)).toBe("قطعة واحدة");
    expect(plural("ar", "pieces", 2)).toBe("قطعتان");
    expect(plural("ar", "pieces", 3)).toBe("3 قطع");
    expect(plural("ar", "pieces", 11)).toBe("11 قطعة");
    expect(plural("ar", "shipments", 0)).toBe("لا توجد شحنات");
    expect(plural("en", "shipments", 1200)).toBe("1,200 shipments");
  });
});
