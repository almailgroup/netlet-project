/**
 * `public/asset-recovery.js` is a plain script, so it is run here as a
 * browser would run it — in a window of its own, with a clock, a store and a
 * fetch that record what it does — and driven through the failures it exists
 * for: one stale file, then the old page handed back once more, then a file
 * genuinely missing from a build.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { isStaleBuildError } from "./staleBuild";

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "public", "asset-recovery.js"), "utf8");

type Listener = (event: Record<string, unknown>) => void;

/** A page load: a fresh window running the script, over a store that outlives it, as a tab's does. */
function loadPage(store: Map<string, string>, now: { value: number }) {
  const listeners = new Map<string, Listener[]>();
  const timers: { at: number; run: () => void }[] = [];
  const fetched: string[] = [];
  let reloads = 0;
  const window: Record<string, unknown> = {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    fetch: (url: string) => {
      fetched.push(url);
      return Promise.resolve({ status: 404 });
    },
    setTimeout: (run: () => void, wait: number) => timers.push({ at: now.value + wait, run }),
    location: { reload: () => void (reloads += 1) },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  vm.runInNewContext(SOURCE, { window, Date: { now: () => now.value }, JSON, String, Array, Promise, Number });
  const fire = (type: string, event: Record<string, unknown>) => (listeners.get(type) ?? []).forEach(listener => listener(event));
  return {
    window,
    fetched,
    reloads: () => reloads,
    /** A `<script>` of the old build that the server answered with a 404. */
    failScript: (url: string) => fire("error", { target: { tagName: "SCRIPT", src: url } }),
    /** Vite's own report of a page that could not load its code. */
    failImport: (url: string) => fire("vite:preloadError", { payload: new Error(`Failed to fetch dynamically imported module: ${url}`), preventDefault: () => { throw new Error("must not prevent"); } }),
    loaded: () => fire("load", {}),
    /** Let the fetches settle, then move the clock on and run what came due. */
    async advance(ms: number) {
      await new Promise(resolve => setImmediate(resolve));
      now.value += ms;
      for (const timer of timers.splice(0).sort((a, b) => a.at - b.at)) {
        if (timer.at <= now.value) timer.run();
        else timers.push(timer);
      }
    },
  };
}

describe("asset recovery", () => {
  it("fetches only the file that failed, then reloads at once", async () => {
    const store = new Map<string, string>();
    const now = { value: 1_000_000 };
    const page = loadPage(store, now);
    page.failScript("https://netlet.net/assets/ProductAssistant-CrObTaXE.js");
    await page.advance(0);
    expect(page.fetched).toEqual(["https://netlet.net/assets/ProductAssistant-CrObTaXE.js"]);
    expect(page.reloads()).toBe(1);
  });

  it("tries again, later each time, when the reload is handed the old page", async () => {
    const store = new Map<string, string>();
    const now = { value: 1_000_000 };
    const waits: number[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const page = loadPage(store, now);
      page.failImport("https://netlet.net/assets/ProductDetail-C868STlI.js");
      let waited = 0;
      await page.advance(0);
      while (page.reloads() === 0 && waited < 60_000) {
        await page.advance(1000);
        waited += 1000;
      }
      expect(page.reloads()).toBe(1);
      waits.push(waited);
    }
    expect(waits).toEqual([0, 3000, 10_000, 30_000]);

    /* A file genuinely missing from the build: after the fourth, it stops. */
    const last = loadPage(store, now);
    last.failImport("https://netlet.net/assets/ProductDetail-C868STlI.js");
    await last.advance(60_000);
    expect(last.reloads()).toBe(0);
    expect((last.window.__netletRecover as (failed: string) => boolean)("x")).toBe(false);
  });

  it("starts afresh once a page has run half a minute without a failure", async () => {
    const store = new Map<string, string>();
    const now = { value: 1_000_000 };
    for (let attempt = 0; attempt < 4; attempt++) {
      const page = loadPage(store, now);
      page.failScript("https://netlet.net/assets/a.js");
      await page.advance(30_000);
    }
    const settled = loadPage(store, now);
    settled.loaded();
    await settled.advance(30_000);
    expect(store.size).toBe(0);
    const next = loadPage(store, now);
    next.failScript("https://netlet.net/assets/b.js");
    await next.advance(0);
    expect(next.reloads()).toBe(1);
  });

  it("reads the first version's count, a bare time", async () => {
    const now = { value: 1_000_000 };
    const store = new Map([["netlet:asset-recovery", String(now.value - 5000)]]);
    const page = loadPage(store, now);
    page.failScript("https://netlet.net/assets/a.js");
    await page.advance(2999);
    expect(page.reloads()).toBe(0);
    await page.advance(1);
    expect(page.reloads()).toBe(1);
  });

  it("answers the crash screen, and does nothing without a store to count in", () => {
    const now = { value: 1_000_000 };
    const page = loadPage(new Map(), now);
    const recover = page.window.__netletRecover as (failed: string) => boolean;
    expect(recover("Failed to fetch dynamically imported module: https://netlet.net/assets/x.js")).toBe(true);
    /* A second ask while the reload is coming is the same reload. */
    expect(recover("again")).toBe(true);

    const blocked = loadPage(new Map(), now);
    blocked.window.sessionStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect((blocked.window.__netletRecover as (failed: string) => boolean)("x")).toBe(false);
  });
});

describe("a stale build is told from a real fault", () => {
  it("knows each browser's words for it", () => {
    expect(isStaleBuildError(new TypeError("Failed to fetch dynamically imported module: https://netlet.net/assets/a.js"))).toBe(true);
    expect(isStaleBuildError(new TypeError("error loading dynamically imported module: https://netlet.net/assets/a.js"))).toBe(true);
    expect(isStaleBuildError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleBuildError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
    expect(isStaleBuildError(new TypeError("Cannot read properties of undefined (reading 'default')"))).toBe(false);
    expect(isStaleBuildError(null)).toBe(false);
  });
});
