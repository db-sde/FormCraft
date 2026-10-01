"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { logInAction, type ActionResult } from "../actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  AuthActions,
  AuthCard,
  AuthField,
  AuthFooter,
  AuthNotice,
} from "@/components/auth/auth-ui";

const initialState: ActionResult = {};

/** ?next= comes from the middleware when it bounced an unauthenticated
 * visitor off a protected page; it's validated server-side. */
function NextField() {
  const next = useSearchParams().get("next");
  return next ? <input type="hidden" name="next" value={next} /> : null;
}

const NOTICES: Record<string, { tone: "info" | "warn"; text: string }> = {
  confirm_failed: {
    tone: "info",
    text: "We couldn't sign you in from that link. If you just confirmed your email, log in below.",
  },
  link_invalid: {
    tone: "warn",
    text: "That password reset link has expired or was already used. Use “Forgot password?” to get a new one.",
  },
};

/** Explains where an emailed auth link left the user (see /auth/confirm). */
function LinkNotice() {
  const notice = NOTICES[useSearchParams().get("notice") ?? ""];
  return notice ? <AuthNotice tone={notice.tone}>{notice.text}</AuthNotice> : null;
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(logInAction, initialState);

  return (
    <AuthCard title="Log in" subtitle="Welcome back.">
      <form action={formAction} className="flex flex-1 flex-col gap-[22px] sm:gap-[18px]">
        {state.error ? (
          <AuthNotice tone={state.errorTone ?? "error"}>{state.error}</AuthNotice>
        ) : (
          <Suspense>
            <LinkNotice />
          </Suspense>
        )}
        <Suspense>
          <NextField />
        </Suspense>
        <AuthField
          id="email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          defaultValue={state.values?.email}
          error={state.fieldErrors?.email}
          required
        />
        <AuthField
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={state.fieldErrors?.password}
          link={{ href: "/forgot-password", label: "Forgot password?" }}
          required
        />
        <AuthActions>
          <Button
            type="submit"
            size="auth"
            className="shadow-card h-[52px] w-full text-base sm:h-[46px] sm:text-[15px]"
            disabled={pending}
            data-loading={pending || undefined}
          >
            {pending && <ButtonSpinner />}
            {pending ? "Logging in…" : "Log in"}
          </Button>
          <AuthFooter
            text="Don't have an account?"
            link={{ href: "/signup", label: "Sign up" }}
          />
        </AuthActions>
      </form>
    </AuthCard>
  );
}
