/**
 * No hook below a `return`.
 *
 * `QuickView` called `useBuyNow()` after `if (!product) return null`. The
 * popup renders with no product first, so that hook ran on the second render
 * and not the first, and React refused the whole page with error #310 — the
 * preview on every product card replaced the shop with "An unexpected error
 * occurred". Nothing in the toolchain catches it: there is no lint step, and
 * the type checker has no opinion about the order of calls.
 *
 * So this reads every component and hook in the client and fails on a call to
 * `use…()` that comes after the function's first `return`. Nested functions
 * are cut out first — a `return` inside a callback is the callback's — and
 * comments and string contents go too, so prose about a hook is not a hook.
 * It is a scan, not a parser, and it is deliberately the narrow one: a hook
 * inside an `if` is the same mistake and is not looked for here.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Source with comments removed and every string and template emptied. */
function codeOnly(source: string): string {
  let out = "";
  let i = 0;
  /* One entry per open `${`, counting the braces opened inside it. */
  const templates: number[] = [];
  const inTemplate = () => templates.length > 0 && templates[templates.length - 1] === -1;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (inTemplate()) {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { templates.pop(); out += c; i += 1; continue; }
      if (c === "$" && next === "{") { templates.push(0); out += "${"; i += 2; continue; }
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") { while (i < source.length && source[i] !== "\n") i += 1; continue; }
    if (c === "/" && next === "*") { const end = source.indexOf("*/", i + 2); i = end === -1 ? source.length : end + 2; continue; }
    if (c === '"' || c === "'") {
      out += c;
      i += 1;
      while (i < source.length && source[i] !== c && source[i] !== "\n") i += source[i] === "\\" ? 2 : 1;
      out += c;
      i += 1;
      continue;
    }
    if (c === "`") { templates.push(-1); out += c; i += 1; continue; }
    if (templates.length) {
      if (c === "{") templates[templates.length - 1] += 1;
      if (c === "}") {
        if (templates[templates.length - 1] === 0) { templates.pop(); out += c; i += 1; continue; }
        templates[templates.length - 1] -= 1;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Index just past the bracket matching the one at `open`. */
function closing(source: string, open: number): number {
  const pair: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const want = pair[source[open]];
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === source[open]) depth += 1;
    else if (source[i] === want && --depth === 0) return i + 1;
  }
  return source.length;
}

/** The body with every function inside it cut out, so each `return` left is the body's own. */
function ownStatements(body: string): string {
  let out = body;
  for (;;) {
    const arrow = /=>\s*\{/.exec(out);
    const named = /\bfunction\b[^(]*\(/.exec(out);
    const first = [arrow, named].filter((m): m is RegExpExecArray => Boolean(m)).sort((a, b) => a.index - b.index)[0];
    if (!first) return out;
    let open: number;
    if (first === arrow) open = first.index + first[0].length - 1;
    else {
      const afterParams = closing(out, first.index + first[0].length - 1);
      open = out.indexOf("{", afterParams);
      if (open === -1) return out;
    }
    out = out.slice(0, first.index) + " " + out.slice(closing(out, open));
  }
}

/** Every component (capitalised) and hook (`useX`) in a file, as [name, own statements]. */
function functionsIn(code: string): [string, string][] {
  const found: [string, string][] = [];
  const starts = /\bfunction\s+([A-Z]\w*|use[A-Z]\w*)\s*(?:<[^>(]*>)?\s*\(|\bconst\s+([A-Z]\w*|use[A-Z]\w*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g;
  for (const match of code.matchAll(starts)) {
    const name = match[1] ?? match[2];
    const afterParams = closing(code, match.index! + match[0].length - 1);
    /* An arrow component must reach `=>` and then a block; an expression body has no statements to order. */
    const rest = code.slice(afterParams);
    const head = match[2] ? /^\s*(?::[^=]+)?=>\s*\{/.exec(rest) : /^[^{;]*\{/.exec(rest);
    if (!head) continue;
    const open = afterParams + head[0].length - 1;
    found.push([name, ownStatements(code.slice(open + 1, closing(code, open) - 1))]);
  }
  return found;
}

/**
 * Hooks called after the first `return`, by name. A hook that *is* that
 * return's value — `return useCallback(…)` — runs every time and is fine.
 */
function hooksAfterReturn(statements: string): string[] {
  const first = /\breturn\b/.exec(statements);
  if (!first) return [];
  const rest = statements.slice(first.index);
  const returned = /^return\s+(use[A-Z]\w*)\s*\(/.exec(rest);
  const hooks = [...rest.matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]);
  return returned ? hooks.slice(1) : hooks;
}

function clientSources(): [string, string][] {
  const root = path.resolve(import.meta.dirname, "../..");
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push([path.relative(root, full), codeOnly(readFileSync(full, "utf-8"))]);
      }
    }
  };
  walk(path.join(root, "src"));
  return out;
}

describe("hook order", () => {
  it("never calls a hook after a component or hook has returned", () => {
    const offenders = clientSources().flatMap(([file, code]) =>
      functionsIn(code).flatMap(([name, statements]) =>
        hooksAfterReturn(statements).map((hook) => `${file}: ${name} calls ${hook}() after a return`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  /* The guard is only worth having if it sees the shape that broke the preview. */
  it("finds the early return that broke Quick View, and passes the fix", () => {
    const broken = codeOnly(`export function QuickView({ product }: { product: P | null }) {
      const [n, setN] = useState(1);
      if (!product) return null;
      const buyNow = useBuyNow();
      return <div onClick={() => { if (n) return; buyNow(); }} />;
    }`);
    expect(functionsIn(broken).flatMap(([, body]) => hooksAfterReturn(body))).toEqual(["useBuyNow"]);

    const fixed = codeOnly(`export function QuickView({ product }: { product: P | null }) {
      const [n, setN] = useState(1);
      const buyNow = useBuyNow();
      if (!product) return null;
      const label = items.map(item => { return useless(item); });
      return <div title="return useX()" onClick={() => buyNow()} />;
    }`);
    expect(functionsIn(fixed).flatMap(([, body]) => hooksAfterReturn(body))).toEqual([]);
  });

  it("reads arrow components and hooks as well as declarations", () => {
    const code = codeOnly(`const Panel = ({ open }: Props) => {
      if (!open) return null;
      const t = useTranslation();
      return null;
    };
    export function useThing(x: number) {
      if (!x) return 0;
      return useMemo(() => x, [x]);
    }`);
    expect(functionsIn(code).map(([name, body]) => [name, hooksAfterReturn(body)])).toEqual([
      ["Panel", ["useTranslation"]],
      ["useThing", ["useMemo"]],
    ]);
  });

  it("allows a hook that is the function's only return", () => {
    const code = codeOnly(`export function useMoney() {
      const { locale } = useTranslation();
      return useCallback((value: string) => format(value, locale), [locale]);
    }`);
    expect(functionsIn(code).flatMap(([, body]) => hooksAfterReturn(body))).toEqual([]);
  });
});
