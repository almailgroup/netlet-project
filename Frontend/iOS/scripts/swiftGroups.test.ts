import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* A SwiftUI `Group` is not a view of its own: what is chained onto it is
   applied to each of its children. That is harmless for a font and a trap
   for anything that runs when a view appears, changes or presents:

   - an empty `Group` (`Group { if something { … } }`) has no child, so a
     `.task` on it never runs — the store's warnings card never loaded on a
     store's own overview, because it waited for warnings to draw itself;
   - a `Group` whose children come and go runs it again for every child that
     appears — the product editor's `.onAppear(perform: fill)` put the saved
     product back over the form whenever a new box appeared, so "Add a size
     chart" snapped back to the button and "Offer to affiliates" snapped back
     off, and the product page fetched the product twice, once for the
     waiting page and again when the page itself replaced it;
   - a `Group` of several children runs it once per child — a fulfilment
     section asked the server once for its heading and once for its list.

   Such a modifier goes on a container that is one view whatever it holds (a
   `VStack` with the parent's spacing, or a `ZStack` round one of two pages). */
const LIFECYCLE = new Set([
  "task",
  "onAppear",
  "onDisappear",
  "onChange",
  "onReceive",
  "refreshable",
  "alert",
  "confirmationDialog",
  "sheet",
  "fullScreenCover",
  "popover",
]);

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

/** The index just past the bracket that closes the one at `open`. */
function closing(text: string, open: number): number {
  const pair: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const want = pair[text[open]];
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      // A string: skip to its end, escapes included, so a brace inside one is not counted.
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      continue;
    }
    if (c === text[open]) depth += 1;
    else if (c === want) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** The names of the modifiers chained straight after the block that ends at `from`. */
export function chainAfter(text: string, from: number): string[] {
  const names: string[] = [];
  let at = from;
  for (;;) {
    const rest = text.slice(at);
    // Comments between modifiers are skipped, as Swift skips them.
    const lead = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/.exec(rest)?.[0].length ?? 0;
    const call = /^\.([A-Za-z]+)\b/.exec(rest.slice(lead));
    if (!call) return names;
    names.push(call[1]);
    at += lead + call[0].length;
    // Its arguments and trailing closures, labelled ones included (`message: { … }`).
    for (;;) {
      const gap = /^\s*/.exec(text.slice(at))?.[0].length ?? 0;
      const next = text[at + gap];
      if (next === "(" || next === "{") {
        at = closing(text, at + gap);
        continue;
      }
      const label = /^\s*[A-Za-z]+:\s*\{/.exec(text.slice(at));
      if (label) {
        at = closing(text, at + label[0].length - 1);
        continue;
      }
      break;
    }
  }
}

/** Every `Group { … }` in a file, with where it starts and what is chained onto it. */
export function groupsIn(text: string): { line: number; chained: string[] }[] {
  const found: { line: number; chained: string[] }[] = [];
  for (const match of text.matchAll(/(?<![A-Za-z0-9_.])Group\s*\{/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    found.push({ line: text.slice(0, match.index).split("\n").length, chained: chainAfter(text, closing(text, open)) });
  }
  return found;
}

describe("a Group in the app", () => {
  it("reads a chain the way Swift does", () => {
    const sample = `Group {
        if on { Text("a {b}") }
      }
      // what follows
      .padding(4)
      .confirmationDialog("x", isPresented: $p) { Button("y") {} } message: { Text("z") }
      .task { await load() }
    `;
    expect(groupsIn(sample)).toEqual([{ line: 1, chained: ["padding", "confirmationDialog", "task"] }]);
    expect(groupsIn(`VStack { Group { Text("a") }.font(.body) }.task {}`)).toEqual([{ line: 1, chained: ["font"] }]);
  });

  it("never carries what runs when a view appears, changes or presents", () => {
    const sources = APP_FOLDERS.flatMap((folder) => swiftSources(folder));
    const offenders: string[] = [];
    let groups = 0;
    for (const { file, text } of sources) {
      for (const group of groupsIn(text)) {
        groups += 1;
        for (const name of group.chained) if (LIFECYCLE.has(name)) offenders.push(`${file}:${group.line} .${name}`);
      }
    }
    // A scan that finds nothing passes: it has read the app's Groups.
    expect(sources.length).toBeGreaterThan(200);
    expect(groups).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });
});
