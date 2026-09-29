import Link from "next/link";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { logOutAction } from "../(auth)/actions";
import { SubmitButton } from "@/components/submit-button";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { workspace, user } = await getCurrentWorkspace();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/dashboard" className="shrink-0 font-semibold tracking-tight">
            FormCraft
          </Link>
          <DashboardNav />
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span className="text-muted-foreground hidden min-w-0 truncate text-sm md:inline">
            {workspace.name} · {user.email}
          </span>
          <form action={logOutAction}>
            <SubmitButton variant="ghost" size="sm">
              Log out
            </SubmitButton>
          </form>
        </div>
      </header>
      <main className="bg-muted/20 flex-1">{children}</main>
    </div>
  );
}
