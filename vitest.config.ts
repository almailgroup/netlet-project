import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "Shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Every layer, so a test cannot be silently skipped by living beside the
    // code it covers. The previous server-only glob is why Shared/ tests never
    // ran and why unrelated suites were filed under server/.
    /*
     * `scripts/` is in the list because the things in it are code: the
     * bootstrap generator and the requirements counter both decide something
     * that is wrong silently. Leaving them out of the run meant a script could
     * not be tested even if somebody wrote a test for it — which is what
     * happened the first time one was.
     */
    /* `workers/` holds the AI gateway, a Cloudflare Worker that is deployed
       on its own and would otherwise have no tests anybody runs. */
    include: ["{server,Shared,client,scripts,workers}/**/*.{test,spec}.{ts,tsx}"],
  },
});
