import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { cannotEdit, statusNotice } from "@/domains/workspaces/status";
import { canEdit, getWorkspaceOverview } from "@/domains/workspaces";
import { isGoogleOAuthConfigured } from "@/domains/sheets/oauth";
import { AppShell } from "./app-shell";

/** The signed-in app frame (sidebar + content) with the current
 * workspace's data — shared by the dashboard pages and a form's
 * Responses / Integrations / Settings / Share pages. */
export async function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { supabase, workspace, workspaces, user } = await getCurrentWorkspace();
  const overview = await getWorkspaceOverview(supabase, workspace.id, {
    sheetsAvailable: isGoogleOAuthConfigured(),
  });

  return (
    <AppShell
      workspaceName={workspace.name}
      workspaceId={workspace.id}
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role }))}
      // Suspended by FormCraft: read-only (the database enforces it too).
      canEdit={canEdit(workspace.role) && !cannotEdit(workspace)}
      memberCount={overview.memberCount}
      formCount={overview.formCount}
      steps={overview.steps}
      userName={(user.user_metadata?.full_name as string | undefined) ?? ""}
      userEmail={user.email ?? ""}
    >
      {statusNotice(workspace) && (
        <div
          role="status"
          className="mx-4 mt-4 rounded-sm border-[1.5px] border-[var(--alert-warning-border)] bg-[var(--alert-warning-bg)] px-3 py-2.5 text-[13.5px] text-[var(--alert-warning-fg)] sm:mx-8"
        >
          {statusNotice(workspace)}
        </div>
      )}
      {children}
    </AppShell>
  );
}
