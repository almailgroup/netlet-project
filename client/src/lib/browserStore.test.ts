/**
 * Storage that refuses, and the rule that nothing else may ask it directly.
 *
 * The unit tests are cheap; the source scan at the bottom is the one that
 * matters. Three callers wrapped their `localStorage` access and four did not,
 * and the four included `CustomerProvider` — which reads the stored locale
 * while it renders, near the root of the tree, so a browser with site data
 * blocked got "An unexpected error occurred" on every page of the shop instead
 * of a lost language preference. Nothing about that is visible in a review, in
 * a type, or in any test that runs in a browser where storage works.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStored, readStoredList, removeStored, writeStored } from "./browserStore.js";

const KEY = "netlet:test-key";

/*
 * A `window` with storage, built here rather than borrowed from a DOM: the
 * whole suite runs in Node, and pulling in jsdom to exercise four functions
 * would be a dependency bought for one file.
 */
function withStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    },
  });
}

/** A browser with site data blocked: the *getter* throws, before any key. */
function withBlockedStorage() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.defineProperty({}, "localStorage", {
      get() {
        throw new Error("SecurityError: Access is denied for this document.");
      },
    }),
  });
}

/** And a server, where there is no `window` at all. */
function withoutWindow() {
  Reflect.deleteProperty(globalThis, "window");
}

afterEach(withoutWindow);

describe("browser storage", () => {
  it("round-trips a value", () => {
    withStorage();
    writeStored(KEY, "kept");
    expect(readStored(KEY)).toBe("kept");
    removeStored(KEY);
    expect(readStored(KEY)).toBeNull();
  });

  it("reads a missing key as absent", () => {
    withStorage();
    expect(readStored("netlet:never-written")).toBeNull();
  });

  it("reads as absent when storage refuses, rather than throwing", () => {
    withBlockedStorage();
    expect(readStored(KEY)).toBeNull();
    expect(readStoredList(KEY)).toEqual([]);
  });

  it("drops a write when storage refuses, rather than throwing", () => {
    withBlockedStorage();
    expect(() => writeStored(KEY, "x")).not.toThrow();
    expect(() => removeStored(KEY)).not.toThrow();
  });

  it("answers for a server with no window at all", () => {
    withoutWindow();
    expect(readStored(KEY)).toBeNull();
    expect(readStoredList(KEY)).toEqual([]);
    expect(() => writeStored(KEY, "x")).not.toThrow();
  });

  it("reads a stored list, and a broken one as empty", () => {
    withStorage();
    writeStored(KEY, JSON.stringify(["a", "b"]));
    expect(readStoredList(KEY)).toEqual(["a", "b"]);
    // Written by an older version of the site, or by hand in the dev tools.
    writeStored(KEY, "not json");
    expect(readStoredList(KEY)).toEqual([]);
    writeStored(KEY, JSON.stringify({ a: 1 }));
    expect(readStoredList(KEY)).toEqual([]);
    writeStored(KEY, JSON.stringify(["a", 2, null]));
    expect(readStoredList(KEY)).toEqual(["a"]);
  });
});

/** Every `.ts`/`.tsx` under the client, as `[repo-relative path, source]`. */
function clientSources(): [string, string][] {
  const root = path.resolve(import.meta.dirname, "../..");
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push([path.relative(root, full), readFileSync(full, "utf-8")]);
    }
  };
  walk(path.join(root, "src"));
  return out;
}

describe("nothing else reaches for localStorage", () => {
  it("has one place that touches it", () => {
    const offenders = clientSources()
      .filter(([file]) => !file.endsWith(`lib${path.sep}browserStore.ts`))
      .filter(([file]) => !file.endsWith(`lib${path.sep}browserStore.test.ts`))
      .filter(([, source]) =>
        source
          // Prose discusses it by name all over this codebase.
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^[ \t]*\/\/.*$/gm, "")
          .match(/\blocalStorage\s*\./),
      )
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
