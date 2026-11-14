import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * `pnpm dev` answers /api from the same code Vercel runs. With no database
 * set, it uses the demo parcels, and the staff desk opens with a password
 * printed below — on a laptop only: none of this reaches a build.
 */
function api(): Plugin {
  return {
    name: "shiplee-api",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv("development", process.cwd(), "");
      Object.assign(process.env, env);
      if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) process.env.SHIPLEE_DEMO ??= "1";
      if (!process.env.STAFF_PASSWORD) {
        process.env.STAFF_PASSWORD = "shiplee-dev-desk";
        server.config.logger.info("  Staff desk (dev only): /staff, password shiplee-dev-desk");
      }
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();
        const { nodeHandler } = (await server.ssrLoadModule("/server/node.ts")) as typeof import("./server/node.js");
        await nodeHandler(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), api()],
  build: { outDir: "dist", sourcemap: false },
  server: { port: 5090 },
});
