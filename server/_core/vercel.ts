/**
 * What gets bundled into the Vercel function.
 *
 * `api/index.ts` is a two-line stub so Vercel detects a function at all; this
 * is the real entry, and `scripts/build-function.mjs` bundles it — with its
 * dependencies — into one self-contained file.
 *
 * Bundling rather than letting Vercel transpile is deliberate, and was learned
 * the expensive way. Transpiled, the function is a tree of loose files run as
 * plain Node ESM, and three separate things broke there while every local
 * check passed: tsconfig path aliases went unresolved, extensionless relative
 * imports were not valid specifiers, and `jwks-rsa` (CommonJS, reached through
 * firebase-admin) could not `require()` the ESM-only `jose`. Bundled, esbuild
 * settles all three at build time and none of them can recur.
 */
import "dotenv/config";
import { createApp } from "./app.js";

export default createApp();
