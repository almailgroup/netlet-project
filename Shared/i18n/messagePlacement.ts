/**
 * Where each word belongs, read off the source: the dictionary's three files
 * and the code that decides between them, for `messagePlacement.test.ts`.
 *
 * - **`dictionary.ts`** holds what the first download may draw: every word
 *   spelled out by a file the shop's entry (`main.tsx`) imports, without a
 *   lazy page between, and every word in `Shared` and on the server, whose
 *   rules hand keys to whatever page is up — a refusal toasted by the bag,
 *   a notice, a problem said under a box.
 * - **`laterMessages.ts`** holds the shop's other words, spelled out only by
 *   pages, dialogs and drawers the shop fetches later (`lazyPage`).
 * - **`portalMessages.ts`** holds the words only `pages/admin` and
 *   `components/admin` spell out.
 *
 * A key is spelled out where it is written in quotes, and asked for wherever a
 * prefix of it is built into one (`` `notice.${kind}.title` ``,
 * `"status." + state`) or held in a constant — any dotted string that is not
 * itself a key is taken for a prefix. Tests are no use of a key.
 *
 * Node only: it reads files. Nothing a page or the server runs imports it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");
const PORTAL = /^Frontend\/Web\/src\/(pages|components)\/admin\//;
const WEB = "Frontend/Web/src";
const SERVER_AND_SHARED = ["Shared", "Backend/src", "Backend/gateway/src", "Backend/scripts", "Frontend/iOS/scripts", "api"];
const NOT_A_USE = /(^|\/)(dictionary|portalMessages|laterMessages|everyMessage|messagePlacement)\.ts$|\.test\.|app\.generated\.js$/;

const text = new Map<string, string>();
/** A file's text, read once. */
export function read(file: string): string {
  let body = text.get(file);
  if (body === undefined) {
    body = readFileSync(path.join(ROOT, file), "utf8");
    text.set(file, body);
  }
  return body;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(relative, out);
    else if (/\.(tsx?|mjs|js)$/.test(entry.name) && !NOT_A_USE.test(relative)) out.push(relative);
  }
  return out;
}

export const isPortal = (file: string) => PORTAL.test(file);
/** The web app's files outside the portal: the shop, first download and later pages alike. */
export const shopWebFiles = (): string[] => walk(WEB).filter(file => !isPortal(file));
/** The portal's files, `pages/admin` and `components/admin`. */
export const portalFiles = (): string[] => walk(WEB).filter(isPortal);
/** `Shared`, the server, the gateway and the scripts. */
export const serverAndShared = (): string[] => SERVER_AND_SHARED.flatMap(dir => walk(dir));

/** A module an import names, as a file in the repository, or null for a package. */
function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `${WEB}/${spec.slice(2)}`;
  else if (spec.startsWith("@shared/")) base = `Shared/${spec.slice("@shared/".length)}`;
  else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
  else return null;
  base = base.replace(/\.js$/, "");
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const full = path.join(ROOT, candidate);
    if (existsSync(full) && statSync(full).isFile() && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

/** What a file imports and runs: static imports and re-exports, never `import type`, never `import()`. */
function staticImports(file: string): string[] {
  const body = read(file);
  const specs = [
    ...body.matchAll(/^\s*import\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/gm),
    ...body.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...body.matchAll(/^\s*export\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/gm),
  ].map(match => match[1]);
  return specs.map(spec => resolve(file, spec)).filter((found): found is string => found !== null);
}

/**
 * Every file the shop's first download runs: `main.tsx` and what it imports,
 * transitively, stopping at every `import()` — which is how a page, a dialog
 * or a drawer the shop fetches later is reached (`lazyPage`).
 */
export function firstDownload(): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of staticImports(file)) visit(next);
  };
  visit(`${WEB}/main.tsx`);
  return [...seen];
}

const DOTTED = /["'`]([a-zA-Z]\w*\.[\w.]+)["'`]/g;

/**
 * Whether these files ask for a key: spelled out, or built from a prefix of
 * it. `every` is every key there is, so a dotted string that is not one is
 * known for a prefix.
 */
export function askedBy(files: string[], every: Iterable<string>): (key: string) => boolean {
  const keys = new Set(every);
  const spelled = new Set<string>();
  const prefixes: string[] = [];
  for (const file of files) {
    /* The dictionary's own files define keys; they are never a use of one. */
    if (NOT_A_USE.test(file)) continue;
    const body = read(file);
    for (const match of body.matchAll(DOTTED)) spelled.add(match[1]);
    for (const match of body.matchAll(/`([a-zA-Z]\w*\.[\w.]*)\$\{/g)) prefixes.push(match[1]);
    for (const match of body.matchAll(/["']([a-zA-Z]\w*\.[\w.]*)["']\s*\+/g)) prefixes.push(match[1]);
  }
  for (const literal of spelled) if (!keys.has(literal)) prefixes.push(literal);
  return key => spelled.has(key) || prefixes.some(prefix => key !== prefix && key.startsWith(prefix));
}
