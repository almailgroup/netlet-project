import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../../../Shared/i18n/dictionary.js";
import { ADMIN_ONLY, COURIER_CAPABILITIES, NEEDS } from "../../../Shared/inventory/permissions.js";
import { staleResources } from "./exportShared.js";

const APP = path.resolve(import.meta.dirname, "..");

function swiftSources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "build" || entry.name.startsWith(".") ? [] : swiftSources(full);
    return entry.name.endsWith(".swift") ? [{ file: path.relative(APP, full), text: readFileSync(full, "utf-8") }] : [];
  });
}

describe("the iOS app's copy of Shared/", () => {
  /* The app cannot import TypeScript, so it reads JSON generated from the
     same modules; a committed copy that differs is a rule changed on one side. */
  it("is what `pnpm ios:resources` would write", () => {
    expect(staleResources()).toEqual([]);
  });

  /* A key the app asks for that the dictionary lacks would draw the key itself
     on screen. Anything in Swift that looks like a key and starts with one of
     the dictionary's namespaces must be a key. There are two look-alikes: a
     procedure's path (`Procedure(query: "orders.list")`), named by what
     precedes it, and a capability the portal asks `can` about
     (`can("product.edit")`), which is one of the permission model's own. */
  it("asks only for keys the dictionary has", () => {
    const namespaces = new Set(Object.keys(en).map((key) => key.split(".")[0]));
    const capabilities = new Set<string>([...Object.keys(NEEDS), ...ADMIN_ONLY, ...COURIER_CAPABILITIES]);
    const missing: string[] = [];
    // The app's own sources, where a key becomes words on screen; the tests
    // quote recorded answers whose JSON carries procedure paths.
    for (const { file, text } of swiftSources(path.join(APP, "NetLet"))) {
      for (const match of text.matchAll(/(query: |mutation: )?"([a-z][A-Za-z]*(?:\.[A-Za-z_]+)+)"/g)) {
        const [, procedure, key] = match;
        if (procedure || capabilities.has(key) || !namespaces.has(key.split(".")[0])) continue;
        if (!(key in en)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
