import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Phone-sized Chromium (runs everywhere CI does, unlike WebKit),
    // limited to the respondent experience and the page smoke test.
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: [
        "smoke.spec.ts",
        "lead-capture.spec.ts",
        "form-starts.spec.ts",
        "partial-response-resume.spec.ts",
      ],
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    // Wait for (or reuse) the server the tests will actually hit, so a
    // custom base URL never "reuses" an unrelated app on port 3000.
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
