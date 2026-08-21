import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Deliberately wide: a spec that the glob misses is silently uncollected
    // and a green run means nothing. A future component/hook test will be
    // picked up here and fail loudly (no jsdom yet) instead of vanishing.
    include: ["{lib,app,components,hooks}/**/*.test.{ts,tsx}"],
  },
});
