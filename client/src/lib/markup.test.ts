/**
 * Markup invariants across client page code, enforced by reading the source.
 *
 * Both rules here are the kind that cost nothing to follow and are invisible
 * when broken: the page still renders, in the wrong language's direction or
 * with forty image requests in flight. A reviewer will not catch either
 * reliably, so a test does.
 *
 * --- 1. `dir` on a block element does two jobs, and page code usually wants one.
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
 *
 * --- 2. Every `<img>` states how it loads.
 *
 * There was one `loading="lazy"` in the whole storefront, so a category page
 * fired every product photo at once — worst exactly where NetLet sells, on a
 * phone. The rule is that the attribute is present, not what it says: the
 * picture of the product on its own page should be `eager`, and the answer is
 * a judgement about the page rather than something a test can make.
 *
 * --- 3. There is one dropdown, and it is the shop's.
 *
 * A native `<select>` opens the operating system's list — grey, square, in
 * the system font — under fields that are otherwise NetLet's own, and the
 * owner asked for every one of them to be designed. `components/ui/Select.tsx`
 * takes the same `<option>` children and the same `onChange`, so a new one
 * written the old way is a one-letter fix; this is what notices it.
 *
 * --- 4. One hover tint.
 *
 * The header's controls shade navy at 6% under a pointer, and the owner asked
 * for everything on the site to answer a pointer that way. Before, nine greys
 * a shade apart did the job on different pages — #f7f9fc, #f2f5f9, #e7edf5,
 * pearl — which read as nine designers. A bare control gets the tint from the
 * stylesheet with no class at all; one with its own fill takes the tint
 * (`hover:bg-[#0a285a]/[.06]`) or, on white, the same colour solid
 * (`hover:bg-[#f0f2f5]`). The rest of the allowed list is a state's own
 * colour: a darker step of a filled navy or red button, a pale red under red
 * words, a white tint on navy.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const INLINE_OR_TYPED = new Set(["input", "textarea", "span", "time", "bdi", "pre"]);

/**
 * Source with its comments removed.
 *
 * Both guards below read markup out of the file, and this codebase explains
 * itself at length — `Thumb.tsx` describes the broken-image case in prose
 * containing a literal `<img>`, and half the files here discuss `dir="ltr"` by
 * name. Scanned raw, a guard reports its own documentation as a violation,
 * which trains everybody to ignore it.
 *
 * Block and JSX comments go; line comments only when they begin a line, so a
 * `https://` inside a string survives.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

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
        out.push([path.relative(root, full), withoutComments(readFileSync(full, "utf-8"))]);
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

/**
 * The whole attribute list of every `<img …>` in a file, one string each.
 *
 * Scanned rather than matched with a regex, because JSX puts `>` inside an
 * attribute: `onError={() => reset()}` ends the tag as far as `[^>]` is
 * concerned, so a regex reads the attributes up to the arrow and reports a
 * perfectly correct image as missing everything after it. Tracking brace depth
 * is the difference between a guard and a guard that cries wolf.
 */
function imageTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<img\b/g)) {
    let depth = 0;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
      index += 1;
    }
    tags.push(source.slice(start, index).replace(/\/$/, ""));
  }
  return tags;
}

describe("image loading", () => {
  it("gives every image an explicit loading strategy", () => {
    const offenders = clientSources().flatMap(([file, source]) =>
      imageTags(source)
        .filter((attributes) => !/\bloading=/.test(attributes))
        .map((attributes) => `${file}: <img ${attributes.trim().replace(/\s+/g, " ").slice(0, 70)}…>`),
    );
    expect(offenders).toEqual([]);
  });

  it("reads a tag's attributes whether it is written on one line or many", () => {
    expect(imageTags(`<img src="a" loading="lazy" />`)).toEqual([` src="a" loading="lazy" `]);
    expect(imageTags(`<img\n  src="a"\n  loading="lazy"\n/>`)).toHaveLength(1);
    expect(imageTags(`<img src="a" /><img src="b" />`)).toHaveLength(2);
    expect(imageTags(`no images here`)).toEqual([]);
    /*
     * The one a regex gets wrong: the arrow in a handler is a `>`, so matching
     * to the first `>` truncates the attributes and reports a correct image as
     * missing its loading strategy.
     */
    expect(imageTags(`<img src="a" onError={() => reset()} loading="lazy" />`)[0])
      .toContain(`loading="lazy"`);
  });

  it("reads code, not the prose explaining it", () => {
    const documented = `/** Handles a broken <img> by drawing a fallback. */\nconst x = 1;`;
    expect(imageTags(withoutComments(documented))).toEqual([]);
    // A line comment goes; a URL that merely looks like one does not.
    expect(withoutComments(`  // <img src="x">\nconst u = "https://a.test/b";`))
      .toContain("https://a.test/b");
  });
});

describe("dropdowns", () => {
  it("draws every select with the shop's own", () => {
    const native = clientSources()
      .filter(([, source]) => /<select[\s>]/.test(source))
      .map(([file]) => file);
    expect(native).toEqual([]);
  });
});

describe("hover", () => {
  const ALLOWED = new Set([
    "hover:bg-[#0a285a]/[.06]", // the header's tint
    "hover:bg-[#f0f2f5]", // the same, solid, on a white fill
    "hover:bg-[#0d3372]", // a step of navy on a navy button
    "hover:bg-[#7a2a1e]", // a step of red on a red button
    "hover:bg-[#fdeceb]", // under red words
    "hover:bg-[#fdf5f3]",
    "hover:bg-[#fff5f3]",
    "hover:bg-white/[.12]", // the tint on navy
    "hover:bg-transparent", // a part of a control that shades as a whole
    "disabled:hover:bg-white",
  ]);

  it("shades every control with the one tint", () => {
    const strays = clientSources().flatMap(([file, source]) =>
      [...source.matchAll(/(?:[\w-]+:)*hover:bg-[^\s"'`}]+/g)]
        .map(match => match[0].replace(/^(?:(?!disabled:)[\w-]+:)*(?=(?:disabled:)?hover:)/, ""))
        .filter(cls => !ALLOWED.has(cls))
        .map(cls => `${file}: ${cls}`),
    );
    expect(strays).toEqual([]);
  });
});
