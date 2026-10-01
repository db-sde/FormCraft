import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { getWorkspaceOverview } from "@/domains/workspaces";
import { AppShell } from "./app-shell";

/** The signed-in app frame (sidebar + content) with the current
 * workspace's data — shared by the dashboard pages and a form's
 * Responses / Integrations / Settings / Share pages. */
export async function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { supabase, workspace, user } = await getCurrentWorkspace();
  const overview = await getWorkspaceOverview(supabase, workspace.id);

  return (
    <AppShell
      workspaceName={workspace.name}
      memberCount={overview.memberCount}
      formCount={overview.formCount}
      steps={overview.steps}
      userName={(user.user_metadata?.full_name as string | undefined) ?? ""}
      userEmail={user.email ?? ""}
    >
      {children}
    </AppShell>
  );
}
