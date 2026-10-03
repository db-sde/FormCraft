import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// The app under test talks to a fake Stripe that payments.spec.ts runs
// (never the real API). The test server inherits this.
export const FAKE_STRIPE_PORT = 4600;
process.env.STRIPE_API_BASE ??= `http://127.0.0.1:${FAKE_STRIPE_PORT}`;

// Likewise the AI features talk to a stand-in Messages API that
// ai.spec.ts runs. The base URL is always overridden, so a real key in
// the environment can never reach the real API from a test run.
export const FAKE_AI_PORT = 4601;
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${FAKE_AI_PORT}`;
process.env.ANTHROPIC_API_KEY ??= "e2e-test-key";

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
