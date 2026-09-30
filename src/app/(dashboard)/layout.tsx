import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { AppShell } from "@/components/app-shell/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { workspace, user } = await getCurrentWorkspace();

  return (
    <AppShell
      workspaceName={workspace.name}
      userName={(user.user_metadata?.full_name as string | undefined) ?? ""}
      userEmail={user.email ?? ""}
    >
      {children}
    </AppShell>
  );
}
