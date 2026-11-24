import { AuthCard } from "@/components/auth/auth-ui";
import { Button } from "@/components/ui/button";
import { staffSignOutAction } from "../actions";

export default function NoAccessPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <AuthCard
        title="No staff access"
        subtitle="This account isn't an active FormCraft staff account. If it should be, ask an owner."
      >
        <form action={staffSignOutAction}>
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </AuthCard>
    </main>
  );
}
