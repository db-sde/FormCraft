"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type ActionResult } from "../actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  AuthActions,
  AuthCard,
  AuthField,
  AuthFooter,
  AuthNotice,
} from "@/components/auth/auth-ui";

const initialState: ActionResult = {};

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    initialState,
  );

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter the email you signed up with and we'll send you a link to choose a new password."
    >
      <form action={formAction} className="flex flex-1 flex-col gap-[22px] sm:gap-[18px]">
        {state.error && <AuthNotice>{state.error}</AuthNotice>}
        <AuthField
          id="email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          error={state.fieldErrors?.email}
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
            {pending ? "Sending…" : "Send reset link"}
          </Button>
          <AuthFooter
            text="Remembered it?"
            link={{ href: "/login", label: "Back to log in" }}
          />
        </AuthActions>
      </form>
    </AuthCard>
  );
}
