/**
 * Files allowed to use the service-role client (createAdminClient), which
 * skips row-level security — each with why. Hardening (2026-11-03): this
 * list may only shrink. A new use must be added here in review, with its
 * reason; prefer the signed-in user's client, a narrow helper
 * (recordAudit, rateLimit) or a security-definer function.
 */
export const ADMIN_CLIENT_ALLOWED: Record<string, string> = {
  "src/app/(auth)/two-factor/actions.ts":
    "MFA recovery codes and factor removal (server-only secrets, Auth admin API)",
  "src/app/(dashboard)/actions.ts":
    "AI credit accounting and its rate limit (server-only tables)",
  "src/app/(dashboard)/bookings/actions.ts":
    "hosts' calendar connections (encrypted tokens) and cancelling bookings (server-written)",
  "src/app/(dashboard)/bookings/page.tsx":
    "the host's calendar connection and calendar list (encrypted tokens)",
  "src/app/(dashboard)/settings/actions.ts":
    "account deletion (Auth admin API); retention set by admins (RLS lets only the owner update workspaces)",
  "src/app/(dashboard)/settings/api-key-actions.ts":
    "creating API keys (hashed, server-only table)",
  "src/app/(dashboard)/settings/connection-actions.ts":
    "storing provider credentials (encrypted, no client access)",
  "src/app/(dashboard)/settings/domain-actions.ts":
    "custom domain registration and DNS verification (server-written)",
  "src/app/(dashboard)/settings/page.tsx":
    "counting the user's remaining MFA recovery codes (server-only)",
  "src/app/(dashboard)/settings/security-actions.ts":
    "SCIM tokens (hashed, server-only) and audit entries",
  "src/app/(dashboard)/settings/team-actions.ts":
    "invitations and acceptance across workspaces (Auth admin API)",
  "src/app/(form)/forms/[id]/(sections)/integrations/actions.ts":
    "data lookups' encrypted headers and webhook test deliveries (server-only)",
  "src/app/(form)/forms/[id]/(sections)/integrations/connector-actions.ts":
    "app connections (encrypted tokens, no client access)",
  "src/app/(form)/forms/[id]/(sections)/responses/actions.ts":
    "removing a deleted response's stored files (private storage)",
  "src/app/(form)/forms/[id]/(sections)/responses/ai-actions.ts":
    "AI credit accounting and response analysis (server-only)",
  "src/app/(form)/forms/[id]/(sections)/responses/page.tsx":
    "confidential 360 report: averages over responses nobody may read individually",
  "src/app/(form)/forms/[id]/(sections)/responses/records-actions.ts":
    "replaying server-written deliveries and jobs; timeline entries",
  "src/app/(form)/forms/[id]/(sections)/settings/actions.ts":
    "form passwords and kiosk PINs (hashed, server-only)",
  "src/app/(form)/forms/[id]/(sections)/settings/page.tsx":
    "whether a password or kiosk PIN is set, and the accepted-response count (server-only)",
  "src/app/(form)/forms/[id]/actions.ts": "theme asset uploads (storage), AI credits",
  "src/app/api/bookings/manage/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/bookings/slots/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/connectors/oauth/callback/route.ts":
    "storing a new connection's encrypted tokens (no client access)",
  "src/app/api/cron/connectors/route.ts": "scheduled worker: no user, CRON_SECRET",
  "src/app/api/cron/digests/route.ts": "scheduled worker: no user, CRON_SECRET",
  "src/app/api/cron/domains/route.ts": "scheduled worker: no user, CRON_SECRET",
  "src/app/api/cron/health/route.ts": "scheduled worker: no user, CRON_SECRET",
  "src/app/api/cron/retention/route.ts": "scheduled worker: no user, CRON_SECRET",
  "src/app/api/cron/sheets/dispatch/route.ts": "scheduled worker: no user, CRON_SECRET",
  "src/app/api/cron/webhooks/dispatch/route.ts": "scheduled worker: no user, CRON_SECRET",
  "src/app/api/embed/events/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/forms/[id]/responses/[responseId]/documents/[kind]/route.ts":
    "document numbering (service-only function) and signature images (private storage)",
  "src/app/api/payments/quote/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/payments/razorpay/[workspaceId]/route.ts":
    "payment provider webhook: no user, signature-verified",
  "src/app/api/payments/razorpay/verify/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/payments/shared.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/payments/start/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/payments/stripe/[workspaceId]/route.ts":
    "payment provider webhook: no user, signature-verified",
  "src/app/api/responses/[id]/answers/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/responses/[id]/complete/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/responses/[id]/follow-up/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/responses/[id]/lookup/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/responses/[id]/resume-link/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/responses/[id]/uploads/[questionId]/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/responses/events/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/responses/kiosk-exit/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/responses/start/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/responses/unlock/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/responses/view/route.ts":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/api/scim/v2/shared.ts": "API key / SCIM token requests: no Supabase session",
  "src/app/api/v1/shared.ts": "API key / SCIM token requests: no Supabase session",
  "src/app/auth/confirm/route.ts": "email confirmation before a session exists",
  "src/app/booking/[token]/page.tsx":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/f/[slug]/page.tsx":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/f/[slug]/payment/page.tsx":
    "anonymous respondent: authorised by the response id or token, not a session",
  "src/app/invite/[token]/page.tsx":
    "reading an invitation by its token before the invitee belongs to the workspace",
  "src/domains/abuse/limit.ts": "narrow helper that holds the key itself",
  "src/domains/audit/record.ts": "narrow helper that holds the key itself",
  "src/lib/analytics/track.ts": "analytics events (written by the server only)",
};
