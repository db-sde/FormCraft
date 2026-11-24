import type { WorkspaceSummary } from "./queries";

/**
 * Account status set by FormCraft staff (Super Admin, migration 71). The
 * database enforces it (read-only rules, no responses, no publishing);
 * these are the same rules for the app's own messages.
 *
 * - restricted: no new forms and no publishing; everything else works.
 * - suspended: read-only, and its forms take no responses. Data can still
 *   be seen and exported.
 */
type Status = Pick<WorkspaceSummary, "status" | "statusMessage">;

export function statusNotice(workspace: Status): string | null {
  if (workspace.status === "active") return null;
  const extra = workspace.statusMessage ? ` ${workspace.statusMessage}` : "";
  return workspace.status === "suspended"
    ? `FormCraft has suspended this workspace: your forms aren't taking responses and nothing can be changed. You can still see and export your data.${extra} Contact FormCraft support to sort it out.`
    : `FormCraft has limited this workspace: you can't create or publish forms for now. Live forms keep working.${extra} Contact FormCraft support to sort it out.`;
}

/** Why this workspace can't create or publish forms, or null. */
export function cannotCreate(workspace: Status): string | null {
  return workspace.status === "active"
    ? null
    : workspace.status === "suspended"
      ? "This workspace is suspended, so nothing can be created or published."
      : "This workspace can't create or publish forms right now. Contact FormCraft support.";
}

/** Why this workspace can't be changed at all, or null. */
export function cannotEdit(workspace: Status): string | null {
  return workspace.status === "suspended"
    ? "This workspace is suspended, so nothing can be changed."
    : null;
}
