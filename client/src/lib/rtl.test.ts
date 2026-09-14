/**
 * `dir` on a block element does two jobs, and page code usually wants one.
 *
 * Setting `dir="ltr"` isolates the text run *and* moves the whole block to the
 * left of its container. On an Arabic page that is how an email address ends
 * up alone at the far edge while the label above it hugs the other side — the
 * account card, the people list and the store header all did exactly that.
 *
 * The fix is `<bdi dir="ltr">` around the value: the run reads left to right,
 * the line it sits on still takes the page's side. So `dir="ltr"` is allowed
 * only where taking a side is the actual intent:
 *
 * - a form control, where it sets the direction the shopper types in;
 * - an inline run (`span`, `time`, `bdi`), which has no side of its own;
 * - `pre`, where the content is a stack trace and left-aligned is correct.
 *
 * `dir="auto"` is deliberately not policed. On merchant prose — a description,
 * a specification row — flipping the block is the documented intent: the text
 * is in whatever language the merchant typed and should be laid out as such.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const INLINE_OR_TYPED = new Set(["input", "textarea", "span", "time", "bdi", "pre"]);

/** Every `.tsx` under the client, as `[repo-relative path, source]`. */
function clientSources(): [string, string][] {
  const root = path.resolve(import.meta.dirname, "../..");
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // The unused shadcn primitives are left as they came.
      else if (entry.name.endsWith(".tsx") && !full.includes(`${path.sep}ui${path.sep}`)) {
        out.push([path.relative(root, full), readFileSync(full, "utf-8")]);
      }
    }
  };
  walk(path.join(root, "src"));
  return out;
}

/**
 * The tag each `dir="ltr"` sits on: walk back to the `<` that opened the tag,
 * refusing to cross a `>` so an attribute is never credited to an element that
 * already closed.
 */
function tagsCarryingLtr(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/dir="ltr"/g)) {
    const before = source.slice(0, match.index);
    const open = before.lastIndexOf("<");
    if (open === -1 || before.slice(open).includes(">")) continue;
    const name = /^<\s*([A-Za-z][\w.-]*)/.exec(before.slice(open))?.[1];
    if (name) tags.push(name);
  }
  return tags;
}

describe("bidi isolation", () => {
  it("keeps dir=ltr off block elements", () => {
    const offenders = clientSources().flatMap(([file, source]) =>
      tagsCarryingLtr(source)
        .filter((tag) => !INLINE_OR_TYPED.has(tag))
        .map((tag) => `${file}: <${tag} dir="ltr">`),
    );
    expect(offenders).toEqual([]);
  });

  it("finds the tag an attribute belongs to", () => {
    expect(tagsCarryingLtr(`<p dir="ltr">x</p>`)).toEqual(["p"]);
    expect(tagsCarryingLtr(`<p className="a"\n  dir="ltr"\n>x</p>`)).toEqual(["p"]);
    expect(tagsCarryingLtr(`<p><bdi dir="ltr">x</bdi></p>`)).toEqual(["bdi"]);
    // Past the closing bracket the attribute belongs to no tag at all.
    expect(tagsCarryingLtr(`<p>dir="ltr"</p>`)).toEqual([]);
  });
});
