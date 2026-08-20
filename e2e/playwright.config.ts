// Playwright config of the real-stack E2E suite (CLAUDE.md, "Kritische Pfade").
//
// No webServer entry and no baseURL here on purpose: every test brings its own
// server process on its own port against its own campaign copy (support/test.ts
// — the `server` fixture overrides `baseURL`). The global setup builds the app
// and starts the stub LLM once for the whole run.
//
// Spec files are named *.e2e.ts so `bun test` at the repo root never picks
// them up — Bun's test runner matches *.test.ts and *.spec.ts.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.e2e\.ts$/,
  globalSetup: "./support/global-setup.ts",
  // Every test is independent (own server, own files), so full parallelism is
  // safe; the port ranges in support/test.ts are per worker.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["list"]]
    : [["list"], ["html", { open: "never" }]],
  outputDir: "./test-results",
  use: {
    // Dark mode is the primary mode (CLAUDE.md, Qualitäts-Boden).
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    // One browser is enough for the critical paths — the suite is about the
    // real stack, not about browser matrices.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
