import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["{src,shared,server,scripts}/**/*.test.{ts,tsx}"],
  },
});
