import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard, AuthNotice } from "@/components/auth/auth-ui";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { StaffSignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/admin/two-factor");
  const { expired } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <AuthCard
        title="FormCraft staff"
        subtitle="For FormCraft staff accounts only. Every sign-in needs your authenticator."
      >
        {expired && (
          <AuthNotice tone="info">
            Your session ended. Sign in again to continue.
          </AuthNotice>
        )}
        <StaffSignInForm />
      </AuthCard>
    </main>
  );
}
