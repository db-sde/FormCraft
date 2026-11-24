import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-ui";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CodeForm, AuthenticatorSetup } from "./two-factor-forms";

export const metadata: Metadata = { title: "Authenticator" };

/**
 * Staff always need their authenticator: to finish signing in, and again
 * (a fresh code) before a high-risk action, which the portal sends here
 * with `next`.
 */
export default async function StaffTwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasFactor = Boolean(factors?.totp?.some((f) => f.status === "verified"));
  const { next } = await searchParams;
  const stepUp = Boolean(next);
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <AuthCard
        title={
          hasFactor
            ? stepUp
              ? "Confirm it's you"
              : "Enter your code"
            : "Set up your authenticator"
        }
        subtitle={
          hasFactor
            ? stepUp
              ? "This action needs a fresh code from your authenticator app."
              : "Open your authenticator app and enter the 6-digit code."
            : "Staff accounts always use an authenticator app (like 1Password, Google Authenticator or Authy)."
        }
      >
        {hasFactor ? <CodeForm next={next} /> : <AuthenticatorSetup />}
      </AuthCard>
    </main>
  );
}
