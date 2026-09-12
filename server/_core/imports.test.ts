/**
 * No path aliases in code the serverless function loads.
 *
 * `@shared/*` and `@/*` are tsconfig `paths` entries. Vite resolves them for
 * the client, and `tsx` and esbuild both read tsconfig, so local dev, `pnpm
 * check` and `pnpm build` all pass with them — which is exactly what makes
 * this dangerous. Vercel compiles `api/index.ts` with its own builder, which
 * does not apply our `paths`, so an aliased import there is unresolvable and
 * the function crashes on load with FUNCTION_INVOCATION_FAILED and no hint
 * about which import was at fault.
 *
 * That is not hypothetical: four files imported `@shared/const`, and the
 * deployed function was dead from the first deploy. Nothing caught it because
 * the site was in demo mode, where the client answers every call itself and
 * never touches `/api`.
 *
 * Server and shared code therefore uses relative paths only. The client keeps
 * its aliases — Vite is the only thing that builds it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...sourceFilesUnder(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      // Tests are built by vitest, which does resolve the aliases. Only code
      // the function actually loads is in scope here.
      out.push(full);
    }
  }
  return out;
}

/** Matches `from "@shared/x"` and `from '@/x'`, both quote styles. */
const ALIAS = /\bfrom\s+["'](@shared\/|@\/)/g;

/** Every `from "./x"` / `from "../x"`, capturing the specifier. */
const RELATIVE = /\bfrom\s+["'](\.[^"']*)["']/g;

const SCOPE = ["server", "shared", "api", "drizzle"];

function shippedFiles(): string[] {
  return SCOPE.flatMap(dir => sourceFilesUnder(path.join(ROOT, dir)));
}

describe("imports reachable from the serverless function", () => {
  it("never use a tsconfig path alias", () => {
    const offenders: string[] = [];
    for (const file of shippedFiles()) {
      if (new RegExp(ALIAS.source).test(readFileSync(file, "utf-8"))) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The second half of the same lesson, and the more expensive one.
   *
   * Vercel transpiles each file rather than bundling, so the function runs as
   * plain Node ESM — where a relative import MUST carry its extension.
   * `from "./app"` resolves under every bundler in this repo (Vite, esbuild,
   * vitest, tsx) and fails only in the one place that matters, with
   * ERR_MODULE_NOT_FOUND at load and the whole function dead.
   *
   * The extension is `.js` even though the file on disk is `.ts`: it names the
   * emitted file, which is what Node will actually look for.
   */
  it("give every relative import an explicit extension", () => {
    const offenders: string[] = [];
    for (const file of shippedFiles()) {
      const source = readFileSync(file, "utf-8");
      for (const match of source.matchAll(new RegExp(RELATIVE.source, "g"))) {
        const specifier = match[1];
        if (!/\.(js|json)$/.test(specifier)) {
          offenders.push(`${path.relative(ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
