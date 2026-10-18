import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

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
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "Shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
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
