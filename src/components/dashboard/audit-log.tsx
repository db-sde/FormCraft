import Link from "next/link";
import type { AuditRecord } from "@/domains/audit";
import { SettingsSection } from "@/components/dashboard/account-settings";

const LABEL: Record<string, string> = {
  "form.published": "Published a form",
  "form.unpublished": "Unpublished a form",
  "form.deleted": "Deleted a form",
  "form.version_restored": "Restored a form version",
  "member.invited": "Invited someone",
  "member.joined": "Joined the workspace",
  "member.role_changed": "Changed a role",
  "member.removed": "Removed a member",
  "member.left": "Left the workspace",
  "invitation.revoked": "Cancelled an invitation",
  "integration.connected": "Connected an integration",
  "integration.disconnected": "Disconnected an integration",
  "api_key.created": "Created an API key",
  "api_key.revoked": "Revoked an API key",
  "api.hook_created": "API subscribed a hook",
  "api.hook_deleted": "API removed a hook",
  "domain.added": "Added a domain",
  "domain.verified": "Verified a domain",
  "domain.removed": "Removed a domain",
  "export.responses": "Exported responses",
  "export.leads": "Exported leads",
  "plan.changed": "Plan changed",
  "retention.changed": "Changed retention",
  "retention.purged": "Deleted expired responses",
  "permissions.changed": "Changed permissions",
  "security.mfa_enabled": "Turned on two-step sign-in",
  "security.mfa_disabled": "Turned off two-step sign-in",
  "security.recovery_code_used": "Used a recovery code",
};

function details(record: AuditRecord): string {
  const parts = Object.entries(record.metadata)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => `${k}: ${String(v)}`);
  return parts.join(" · ");
}

/** Settings → Audit log (P3.14): who did what, newest first. */
export function AuditLog({
  records,
  olderHref,
}: {
  records: AuditRecord[];
  olderHref: string | null;
}) {
  return (
    <SettingsSection
      title="Audit log"
      description="Security and admin activity in this workspace. Only owners and admins can see it; entries can't be edited."
      wide
      last
    >
      {records.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
      ) : (
        <ol className="border-ink bg-card overflow-hidden rounded-lg border-[1.5px] text-[13.5px]">
          {records.map((r) => (
            <li
              key={r.id}
              className="border-border grid gap-1 border-b px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[170px_minmax(0,1fr)]"
            >
              <time
                className="text-muted-foreground text-[12.5px]"
                dateTime={r.createdAt}
              >
                {new Date(r.createdAt).toLocaleString("en", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              <span className="min-w-0">
                <b>
                  {r.actorName ||
                    r.actorEmail ||
                    (r.metadata.apiKeyId ? "API key" : "FormCraft")}
                </b>{" "}
                {(LABEL[r.action] ?? r.action).toLowerCase()}
                {details(r) && (
                  <span className="text-muted-foreground block truncate text-[12.5px]">
                    {details(r)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {olderHref && (
        <Link
          href={olderHref}
          className="self-start text-sm font-semibold underline underline-offset-2"
        >
          Older entries
        </Link>
      )}
    </SettingsSection>
  );
}
