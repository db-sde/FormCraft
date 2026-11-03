import * as Sentry from "@sentry/nextjs";

/**
 * Server-side error reporting (Next.js instrumentation). Sentry starts
 * only when NEXT_PUBLIC_SENTRY_DSN is set; without it nothing is sent
 * and errors are still logged (see lib/observability/report.ts).
 * Request errors from route handlers, server actions and pages are
 * captured by onRequestError.
 */
export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}

export const onRequestError = Sentry.captureRequestError;
