import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 15_000,
  fullyParallel: true,
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "node server.mjs",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
