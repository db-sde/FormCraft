"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signUpAction, type ActionResult } from "../actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  AuthActions,
  AuthCard,
  AuthField,
  AuthFooter,
  AuthNotice,
} from "@/components/auth/auth-ui";

const initialState: ActionResult = {};

/** Where to land after confirming the email (e.g. back to an invitation). */
function NextField() {
  const next = useSearchParams().get("next");
  return next ? <input type="hidden" name="next" value={next} /> : null;
}

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <AuthCard title="Create your account" subtitle="Start building forms in minutes.">
      <form action={formAction} className="flex flex-1 flex-col gap-[22px] sm:gap-[18px]">
        <Suspense>
          <NextField />
        </Suspense>
        {state.error && (
          <AuthNotice tone={state.errorTone ?? "error"}>{state.error}</AuthNotice>
        )}
        <AuthField
          id="fullName"
          name="fullName"
          label="Full name"
          autoComplete="name"
          placeholder="Maya Rao"
          defaultValue={state.values?.fullName}
          error={state.fieldErrors?.fullName}
          required
        />
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
          autoComplete="new-password"
          minLength={8}
          helper="At least 8 characters."
          error={state.fieldErrors?.password}
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
            {pending ? "Creating account…" : "Create account"}
          </Button>
          <AuthFooter
            text="Already have an account?"
            link={{ href: "/login", label: "Log in" }}
          />
        </AuthActions>
      </form>
    </AuthCard>
  );
}
