/**
 * Bundles the Vercel function into one self-contained file.
 *
 * Output is `api/app.generated.js`, which `api/index.ts` re-exports. It is
 * gitignored: it is build output, and 3.8MB of it.
 *
 * Nothing is external. Bundling the dependencies is the point — it is what
 * resolves the CommonJS/ESM interop that breaks at runtime otherwise, most
 * sharply `jwks-rsa` doing `require('jose')` when jose 6 is ESM-only.
 */
import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";

/*
 * CommonJS packages call `require()` and use `__dirname` even once bundled
 * into ESM, where neither exists. esbuild's own shim throws on anything it
 * could not statically resolve — dotenv reaching for "fs" is the first thing
 * to hit it — so a real `require` is put back at the top of the file.
 */
const banner = [
  `import { createRequire as __netletCreateRequire } from "node:module";`,
  `import { fileURLToPath as __netletFromFileUrl } from "node:url";`,
  `import { dirname as __netletDirname } from "node:path";`,
  `const require = __netletCreateRequire(import.meta.url);`,
  `const __filename = __netletFromFileUrl(import.meta.url);`,
  `const __dirname = __netletDirname(__filename);`,
].join("\n");

/*
 * The built page shell, for the product and department pages the function
 * answers with their own head (Backend/src/services/pageShell.ts). The function is deployed
 * apart from the static output, so it carries its own copy.
 */
const shellPath = "dist/public/index.html";
const shell = existsSync(shellPath) ? readFileSync(shellPath, "utf8") : null;
if (!shell) console.warn(`[build-function] ${shellPath} is missing — product pages will be served the static shell.`);

await build({
  define: { __NETLET_SHELL__: JSON.stringify(shell) },
  entryPoints: ["Backend/src/core/vercel.ts"],
  outfile: "api/app.generated.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: banner },
  logLevel: "info",
});
