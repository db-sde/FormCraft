import { requireUser } from "@/lib/auth/require-user";
import { PageHeader } from "@/components/app-shell/page-header";
import { AccountSettings } from "@/components/dashboard/account-settings";

export default async function AccountSettingsPage() {
  const { user } = await requireUser();
  return (
    <>
      <PageHeader
        title="Account settings"
        description="Your profile, sign-in details, and account."
      />
      <AccountSettings
        name={(user.user_metadata?.full_name as string | undefined) ?? ""}
        email={user.email ?? ""}
      />
    </>
  );
}
