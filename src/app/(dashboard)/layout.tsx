import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { getWorkspaceOverview } from "@/domains/workspaces";
import { AppShell } from "@/components/app-shell/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
