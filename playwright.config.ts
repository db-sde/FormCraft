import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
// Emailed links (sign-up, password reset) are built from the app URL, so
// the server under test must know the address the tests use.
process.env.NEXT_PUBLIC_APP_URL = baseURL;

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

// And Airtable (master spec Phase 6) is a fake that phase6.spec.ts runs;
// the base URL is always overridden so a test never reaches the real API.
export const FAKE_AIRTABLE_PORT = 4602;
process.env.AIRTABLE_API_BASE = `http://127.0.0.1:${FAKE_AIRTABLE_PORT}`;
process.env.AIRTABLE_CLIENT_ID ??= "e2e-airtable-client";
process.env.AIRTABLE_CLIENT_SECRET ??= "e2e-airtable-secret";

// Email: a stand-in Resend API (tests/e2e/fake-email-server.mjs), so email
// features are on in tests and nothing is ever really sent — the base URL
// is always overridden, whatever key the environment has.
export const FAKE_EMAIL_PORT = 4604;
process.env.RESEND_BASE_URL = `http://127.0.0.1:${FAKE_EMAIL_PORT}`;
process.env.RESEND_API_KEY ||= "re_e2e_fake_key";

// Razorpay (master spec Phase 7): its API and its Checkout script are
// stand-ins that phase7.spec.ts serves — never the real ones in a test.
export const FAKE_RAZORPAY_PORT = 4603;
process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${FAKE_RAZORPAY_PORT}`;
process.env.RAZORPAY_CHECKOUT_SCRIPT = `http://127.0.0.1:${FAKE_RAZORPAY_PORT}/checkout.js`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  // Assertions wait up to 10s (5 by default): pages render server-side
  // against a local Supabase, which a busy machine slows down.
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Locally: 3 by default (the app server, Supabase in Docker and the
  // browsers share one machine; more made timing-based tests flaky).
  // PW_WORKERS overrides.
  workers: process.env.PW_WORKERS
    ? Number(process.env.PW_WORKERS)
    : process.env.CI
      ? 2
      : 3,
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
        // Respondent screens added since: classic pages and kiosk, the
        // booking slot picker, uploads. (Payment specs run fake providers
        // on fixed ports, so they stay desktop-only.)
        "phase1.spec.ts",
        "phase5.spec.ts",
        "file-upload.spec.ts",
      ],
    },
  ],
  webServer: [
    {
      command: "node tests/e2e/fake-email-server.mjs",
      url: `http://127.0.0.1:${FAKE_EMAIL_PORT}/`,
      reuseExistingServer: true,
    },
    {
      command: "npm run build && npm run start",
      // Wait for (or reuse) the server the tests will actually hit, so a
      // custom base URL never "reuses" an unrelated app on port 3000.
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
