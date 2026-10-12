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
import { hasPageHead, pagePathOf, pageWithHead } from "../pageShell.js";
import { createApp, siteOrigin } from "./app.js";

/*
 * The built `index.html`, written into the bundle by `build-function.mjs`. The
 * static output and the function are deployed apart, so the function cannot
 * read the file at runtime; null when the client was not built first.
 */
declare const __NETLET_SHELL__: string | null;
const shell: string | null = typeof __NETLET_SHELL__ === "string" ? __NETLET_SHELL__ : null;

const app = createApp();

/*
 * Product and department pages, rewritten here by `vercel.json` so the first
 * response carries the page's own title, description, share picture, price
 * and structured data (`server/pageShell.ts`). Cached at the edge for five
 * minutes: a price change shows in a preview a little late rather than every
 * visit paying for a catalogue read.
 */
app.get("*", async (req, res, next) => {
  const page = pagePathOf(req);
  if (!shell || !hasPageHead(page)) {
    next();
    return;
  }
  res.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
  res.status(200).type("html").send(await pageWithHead(shell, page, siteOrigin(req)));
});

export default app;
