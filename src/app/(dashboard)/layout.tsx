import Link from "next/link";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { logOutAction } from "../(auth)/actions";
import { Button } from "@/components/ui/button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { workspace, user } = await getCurrentWorkspace();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b px-6">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            FormCraft
          </Link>
          <span className="text-muted-foreground text-sm">{workspace.name}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground text-sm">{user.email}</span>
          <form action={logOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              Log out
            </Button>
          </form>
        </div>
      </header>
      <main className="bg-muted/20 flex-1">{children}</main>
    </div>
  );
}
