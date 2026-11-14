import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

export default defineConfig({
  ...base,
  testDir: "./acceptance",
  // Every test uses the actual shared room; run journeys separately.
  fullyParallel: false,
  workers: 1,
  webServer: [
    { command: "node tests/fixtures/app-server.cjs", url: "http://127.0.0.1:5000/api/health" },
    base.webServer[1],
  ],
});
