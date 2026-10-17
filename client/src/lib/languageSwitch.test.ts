import { afterEach, describe, expect, it, vi } from "vitest";
import { settled, switchLanguage, SWITCH_WAIT_MS } from "./languageSwitch";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("waiting for the new language's words", () => {
  it("lets go once nothing is being fetched", async () => {
    vi.useFakeTimers();
    let busy = true;
    let done = false;
    settled(() => busy).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    busy = false;
    await vi.advanceTimersByTimeAsync(40);
    expect(done).toBe(true);
  });

  /* A slow catalogue never holds the old page for longer than the cap. */
  it("lets go at the cap however long the fetch takes", async () => {
    vi.useFakeTimers();
    let done = false;
    settled(() => true).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(SWITCH_WAIT_MS - 40);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(80);
    expect(done).toBe(true);
  });

  /* The browser draws no frames while a view transition waits on this, so the
     wait must never depend on one: a frame callback that never comes froze
     the page until the browser gave up, four seconds on. */
  it("never waits on an animation frame", async () => {
    vi.useFakeTimers();
    const frame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", frame);
    let done = false;
    settled(() => false).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(40);
    expect(done).toBe(true);
    expect(frame).not.toHaveBeenCalled();
  });
});

describe("switching", () => {
  function stubPage({ transitions, reduced }: { transitions: boolean; reduced: boolean }) {
    const root = { dataset: {} as Record<string, string> };
    const start = vi.fn((update: () => unknown) => {
      void update;
      return { finished: Promise.resolve() };
    });
    vi.stubGlobal("document", {
      documentElement: root,
      visibilityState: "visible",
      ...(transitions ? { startViewTransition: start } : {}),
    });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
    return { start, root };
  }

  it("switches at once where the browser has no view transitions", () => {
    stubPage({ transitions: false, reduced: false });
    const apply = vi.fn();
    switchLanguage(apply, () => false);
    expect(apply).toHaveBeenCalledOnce();
  });

  it("switches at once for somebody who asked for less motion", () => {
    const { start } = stubPage({ transitions: true, reduced: true });
    const apply = vi.fn();
    switchLanguage(apply, () => false);
    expect(apply).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it("fades otherwise, marking the page only while it does", async () => {
    const { start, root } = stubPage({ transitions: true, reduced: false });
    switchLanguage(() => {}, () => false);
    expect(start).toHaveBeenCalledOnce();
    expect(root.dataset.switching).toBe("language");
    await Promise.resolve();
    await Promise.resolve();
    expect(root.dataset.switching).toBeUndefined();
  });
});
