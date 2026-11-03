import * as Sentry from "@sentry/nextjs";

/**
 * Reports an error that was handled on purpose — a background step after
 * a submit, a provider call — so it isn't lost: one structured log line
 * (operation, outcome, ids) and, when Sentry is configured, an event
 * tagged the same way. Ids only; never answers, emails or secrets.
 */
export function reportError(
  error: unknown,
  context: {
    operation: string;
    responseId?: string;
    formId?: string;
    workspaceId?: string;
  },
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      level: "error",
      operation: context.operation,
      outcome: "failed",
      responseId: context.responseId,
      formId: context.formId,
      workspaceId: context.workspaceId,
      message: message.slice(0, 500),
    }),
  );
  try {
    Sentry.captureException(error, {
      tags: {
        operation: context.operation,
        ...(context.responseId ? { responseId: context.responseId } : {}),
        ...(context.formId ? { formId: context.formId } : {}),
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      },
    });
  } catch {
    // Reporting must never throw.
  }
}
