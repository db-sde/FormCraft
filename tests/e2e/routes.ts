/**
 * Every page and API route in the app, and the test that exercises it.
 * tests/unit/route-coverage.test.ts fails when a route exists in
 * src/app but isn't listed here (or vice versa), so a new page can't
 * ship without at least the smoke test rendering it.
 */
export const PAGE_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/signup/check-email",
  "/forgot-password",
  "/forgot-password/check-email",
  "/reset-password",
  "/two-factor",
  "/dashboard",
  "/leads",
  "/templates",
  "/settings",
  "/forms/[id]",
  "/forms/[id]/share",
  "/forms/[id]/responses",
  "/forms/[id]/responses/[responseId]",
  "/forms/[id]/integrations",
  "/forms/[id]/settings",
  "/f/[slug]",
  "/invite/[token]",
  "/f/[slug]/payment",
] as const;

/** API / handler routes → the spec that covers them. */
export const HANDLER_ROUTES: Record<string, string> = {
  "/api/responses/start": "api-contract.spec.ts, form-starts.spec.ts",
  "/api/responses/[id]/answers": "api-contract.spec.ts, autosave-race.spec.ts",
  "/api/responses/[id]/resume-link": "resume-link.spec.ts",
  "/api/responses/[id]/follow-up": "ai.spec.ts",
  "/api/responses/[id]/complete":
    "api-contract.spec.ts, duplicate-submit.spec.ts, submission-integrity.spec.ts",
  "/api/responses/[id]/uploads/[questionId]": "api-contract.spec.ts",
  "/api/responses/events": "api-contract.spec.ts",
  "/api/forms/[id]/export.csv": "access-control.spec.ts",
  "/api/leads/export.csv": "access-control.spec.ts",
  "/api/cron/health": "api-contract.spec.ts",
  "/api/cron/retention": "api-contract.spec.ts",
  "/api/cron/domains": "api-contract.spec.ts",
  "/api/v1/me": "public-api.spec.ts",
  "/api/payments/stripe/[workspaceId]": "payments.spec.ts",
  "/api/v1/forms": "public-api.spec.ts",
  "/api/v1/forms/[id]/responses": "public-api.spec.ts",
  "/api/v1/forms/[id]": "public-api.spec.ts",
  "/api/v1/responses/[id]": "public-api.spec.ts",
  "/api/v1/hooks": "public-api.spec.ts",
  "/api/v1/hooks/[id]": "public-api.spec.ts",
  "/api/cron/sheets/dispatch": "api-contract.spec.ts",
  "/api/cron/webhooks/dispatch": "api-contract.spec.ts",
  "/api/integrations/google/authorize": "access-control.spec.ts",
  "/api/integrations/google/callback": "access-control.spec.ts",
  "/auth/confirm": "password-reset.spec.ts",
};
