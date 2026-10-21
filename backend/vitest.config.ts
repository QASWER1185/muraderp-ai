import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
    },
    // Keep both established test locations in the executable test surface.
    // Pricing/repository/service contract tests currently live under src/**,
    // while the broader regression suite lives under test/**.
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
