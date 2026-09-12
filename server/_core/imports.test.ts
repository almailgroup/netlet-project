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
const ALIAS = /\bfrom\s+["'](@shared\/|@\/)/;

describe("imports reachable from the serverless function", () => {
  it("never use a tsconfig path alias", () => {
    const offenders: string[] = [];
    for (const dir of ["server", "shared", "api"]) {
      for (const file of sourceFilesUnder(path.join(ROOT, dir))) {
        const source = readFileSync(file, "utf-8");
        if (ALIAS.test(source)) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
