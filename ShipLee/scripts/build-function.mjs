/**
 * Bundles the API into api/handler.generated.js, one file with every
 * dependency inside it, which api/index.ts re-exports for Vercel.
 */
import { build } from "esbuild";

/* A CommonJS dependency may still reach for require() inside an ES module. */
const banner = [
  `import { createRequire as __shipleeRequire } from "node:module";`,
  `const require = __shipleeRequire(import.meta.url);`,
].join("\n");

await build({
  entryPoints: ["server/vercel.ts"],
  outfile: "api/handler.generated.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: banner },
  logLevel: "info",
});
