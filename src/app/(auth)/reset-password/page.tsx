"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, Link2Off } from "lucide-react";
import { ResetPasswordInput, mapAuthError } from "@/domains/identity";
import { createClient } from "@/lib/supabase/client";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  AuthActions,
  AuthCard,
  AuthField,
  AuthFooter,
  AuthNotice,
} from "@/components/auth/auth-ui";

const primary = "h-[52px] w-full text-base shadow-card sm:h-[46px] sm:text-[15px]";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<"checking" | "ready" | "invalid" | "saved">(
    "checking",
  );
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(ResetPasswordInput) });

  useEffect(() => {
    // The recovery link establishes a temporary session via the URL
    // fragment/PKCE code, handled automatically by the browser client
    // (detectSessionInUrl). We just need to confirm it landed.
    supabase.auth.getSession().then(({ data }) => {
      setStatus(data.session ? "ready" : "invalid");
    });
  }, [supabase]);

  async function onSubmit(values: ResetPasswordInput) {
    setServerError(null);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setServerError(
        mapAuthError(error.message).code === "weak_password"
          ? mapAuthError(error.message).message
          : "We couldn't save your password. Nothing changed. Please try again.",
      );
      return;
    }
    setStatus("saved");
    router.push("/dashboard");
  }

  if (status === "checking") {
    return (
      <AuthCard title="Checking your link…" subtitle="This only takes a second.">
        <div className="flex justify-center pt-2 pb-1" role="status">
          <span className="size-8 animate-spin rounded-full border-[3px] border-current border-t-transparent" />
        </div>
      </AuthCard>
    );
  }

  if (status === "invalid") {
    return (
      <AuthCard
        icon={{ node: <Link2Off />, tint: "var(--alert-error-bg)" }}
        title="This link has expired"
        subtitle="Reset links work once and only for an hour. Request a new password reset link and try again."
      >
        <AuthActions>
          <Button asChild size="auth" className={primary}>
            <Link href="/forgot-password">Request new link</Link>
          </Button>
          <AuthFooter text="Or go back to" link={{ href: "/login", label: "Log in" }} />
        </AuthActions>
      </AuthCard>
    );
  }

  if (status === "saved") {
    return (
      <AuthCard
        icon={{ node: <CircleCheck />, tint: "var(--alert-success-bg)" }}
        title="Password saved"
        subtitle="You're signed in. Taking you to your forms…"
      >
        <Button asChild size="auth" className={primary}>
          <Link href="/dashboard">Go to your forms</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" subtitle="Make it at least 8 characters.">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-1 flex-col gap-[22px] sm:gap-[18px]"
      >
        {serverError && <AuthNotice>{serverError}</AuthNotice>}
        <AuthField
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          autoFocus
          error={errors.password?.message}
          {...register("password")}
        />
        <AuthField
          id="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />
        <AuthActions>
          <Button
            type="submit"
            size="auth"
            className={primary}
            disabled={isSubmitting}
            data-loading={isSubmitting || undefined}
          >
            {isSubmitting && <ButtonSpinner />}
            {isSubmitting ? "Saving…" : "Save new password"}
          </Button>
        </AuthActions>
      </form>
    </AuthCard>
  );
}
