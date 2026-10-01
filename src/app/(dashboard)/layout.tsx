import { WorkspaceShell } from "@/components/app-shell/workspace-shell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
