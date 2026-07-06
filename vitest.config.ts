import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/model.ts"],
      // Floors so risk-critical coverage can't silently regress. src/index.ts
      // (CLI wiring) and src/model.ts (needs a live API) are excluded.
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 78,
        branches: 70,
      },
    },
  },
});
