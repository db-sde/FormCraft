import { WorkspaceShell } from "@/components/app-shell/workspace-shell";

/** A form's Responses, Integrations, Settings and Share pages sit inside
 * the app frame (Part 5); only the builder is full-screen. */
export default function FormSectionsLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
