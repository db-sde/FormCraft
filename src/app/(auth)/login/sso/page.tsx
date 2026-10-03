"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { ssoLogInAction, type ActionResult } from "../../actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  AuthActions,
  AuthCard,
  AuthField,
  AuthFooter,
  AuthNotice,
} from "@/components/auth/auth-ui";

const initialState: ActionResult = {};

function NextField() {
  const next = useSearchParams().get("next");
  return next ? <input type="hidden" name="next" value={next} /> : null;
}

/** Shown when a workspace the person belongs to only opens to SSO. */
function RequiredNotice() {
  return useSearchParams().get("notice") === "required" ? (
    <AuthNotice tone="info">
      Your workspace requires single sign-on. Enter your work email to continue.
    </AuthNotice>
  ) : null;
}

/** Log in through the company's identity provider (P3.12). */
export default function SsoLoginPage() {
  const [state, formAction, pending] = useActionState(ssoLogInAction, initialState);
  return (
    <AuthCard
      title="Log in with SSO"
      subtitle="Use your company's single sign-on."
      icon={{ node: <KeyRound aria-hidden /> }}
    >
      <form action={formAction} className="flex flex-1 flex-col gap-[22px] sm:gap-[18px]">
        {state.error ? (
          <AuthNotice tone={state.errorTone ?? "error"}>{state.error}</AuthNotice>
        ) : (
          <Suspense>
            <RequiredNotice />
          </Suspense>
        )}
        <Suspense>
          <NextField />
        </Suspense>
        <AuthField
          id="email"
          name="email"
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="name@company.com"
          defaultValue={state.values?.email}
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
            {pending ? "Redirecting…" : "Continue"}
          </Button>
          <AuthFooter
            text="Not using SSO?"
            link={{ href: "/login", label: "Log in with a password" }}
          />
        </AuthActions>
      </form>
    </AuthCard>
  );
}
