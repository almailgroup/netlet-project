import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import type { Rollup } from "vite";
import { routeTable, routesFromApp } from "./Frontend/Web/build/routePreloads";

/**
 * Each shopping address's code, fetched the moment the page arrives rather
 * than once the app has started (`Frontend/Web/build/routePreloads.ts` says
 * why). The build writes the table into the page as data, and
 * `public/route-preload.js` — a file, because the CSP allows no inline script
 * — preloads the one row the address matches. It replaced preloading the
 * product and department pages on every visit, which had every page download
 * two pages it was not.
 */
function routePreloads(): Plugin {
  let base = "/";
  return {
    name: "netlet-route-preloads",
    configResolved(config) { base = config.base; },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const bundle = context.bundle as Rollup.OutputBundle | undefined;
        if (!bundle) return [];
        const chunks = Object.values(bundle).filter((item): item is Rollup.OutputChunk => item.type === "chunk");
        const routes = routesFromApp(readFileSync(path.resolve(import.meta.dirname, "Frontend", "Web", "src", "App.tsx"), "utf8"));
        const { table, unplaced } = routeTable(routes, chunks, base);
        if (unplaced.length) console.warn(`[route preloads] no chunk found for ${unplaced.join(", ")}`);
        return [
          { tag: "script", attrs: { type: "application/json", id: "netlet-routes" }, children: JSON.stringify(table).replace(/</g, "\\u003c"), injectTo: "head-prepend" as const },
          { tag: "script", attrs: { src: `${base}route-preload.js`, async: true }, injectTo: "head-prepend" as const },
        ];
      },
    },
  };
}

/**
 * NetLet build configuration.
 *
 * Deliberately plain: the Manus editor runtime, its JSX source-location
 * annotator and its debug collector all used to sit in this pipeline, inlining
 * a second copy of React into every production page. None of them are here now.
 */
export default defineConfig({
  // Sub-directory deployments (GitHub Pages serves from `/<repo-name>/`) set
  // VITE_BASE_PATH at build time. Unset — dev, and the Express server build —
  // keeps the app at the domain root.
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react(), tailwindcss(), routePreloads()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "Frontend", "Web", "src"),
      "@shared": path.resolve(import.meta.dirname, "Shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "Frontend", "Web"),
  publicDir: path.resolve(import.meta.dirname, "Frontend", "Web", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // React and the data layer change far less often than the storefront
        // does, so they are split into their own chunks: a deploy that only
        // touches NetLet code leaves them cached in every returning browser.
        // `react-dom/client` is named too: the package name alone matched only
        // `react-dom`'s small entry, so the renderer — the largest thing any
        // page downloads — sat in the main chunk and was fetched again after
        // every deploy. Its scheduler follows it in.
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client"],
          data: ["@tanstack/react-query", "@trpc/client", "@trpc/react-query", "superjson"],
        },
      },
    },
  },
  server: {
    host: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
