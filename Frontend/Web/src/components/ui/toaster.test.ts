import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The website's toasts are NetLet's white card with navy words, whatever the
 * phone's own theme, on the owner's word ("why are the alerts in green
 * colour? It should be the same colour palette as the website"). On a phone
 * in dark mode they were sonner's near-black with green words: the wrapper
 * asked `next-themes` for a theme the site never set up, which answers
 * "system", and `richColors` filled a success with green. A browser walk
 * with the phone in dark mode is the proof; this keeps the two causes out.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("the website's toasts", () => {
  const wrapper = read("./sonner.tsx");
  const app = read("../../App.tsx");

  it("always draws in the site's light palette, never the phone's theme", () => {
    expect(wrapper).not.toMatch(/next-themes/);
    expect(wrapper).toMatch(/theme="light"/);
    expect(wrapper).not.toMatch(/theme=\{/);
  });

  it("never fills a toast with sonner's green or red", () => {
    const toasters = app.match(/<Toaster\b[^>]*>/g) ?? [];
    expect(toasters.length).toBeGreaterThan(0);
    for (const toaster of toasters) expect(toaster).not.toMatch(/richColors/);
  });

  it("gives the card NetLet's white, navy and hairline", () => {
    expect(wrapper).toMatch(/"--normal-bg": "var\(--popover\)"/);
    expect(wrapper).toMatch(/"--normal-text": "var\(--popover-foreground\)"/);
    expect(wrapper).toMatch(/"--normal-border": "var\(--border\)"/);
  });
});
