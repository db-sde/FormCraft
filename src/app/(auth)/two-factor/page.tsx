"use client";

import { Suspense, useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import {
  redeemRecoveryCodeAction,
  verifyTwoFactorAction,
  type TwoFactorResult,
} from "./actions";
import { logOutAction } from "../actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { AuthActions, AuthCard, AuthField, AuthNotice } from "@/components/auth/auth-ui";

const initial: TwoFactorResult = {};

function NextField() {
  const next = useSearchParams().get("next");
  return next ? <input type="hidden" name="next" value={next} /> : null;
}

/** Sign-in step two (P3.13): a code from the authenticator app, or a
 * one-time recovery code. */
export default function TwoFactorPage() {
  const [recovery, setRecovery] = useState(false);
  const [state, verify, verifying] = useActionState(verifyTwoFactorAction, initial);
  const [recoveryState, redeem, redeeming] = useActionState(
    redeemRecoveryCodeAction,
    initial,
  );
  const pending = verifying || redeeming;
  const error = recovery ? recoveryState.error : state.error;

  return (
    <AuthCard
      title="Two-factor authentication"
      subtitle={
        recovery
          ? "Enter one of the recovery codes you saved. It turns off your authenticator so you can set it up again."
          : "Enter the 6-digit code from your authenticator app."
      }
      icon={{ node: <ShieldCheck aria-hidden /> }}
    >
      <form
        action={recovery ? redeem : verify}
        className="flex flex-1 flex-col gap-[22px] sm:gap-[18px]"
      >
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        <Suspense>
          <NextField />
        </Suspense>
        {recovery ? (
          <AuthField
            key="recovery"
            id="recoveryCode"
            name="recoveryCode"
            label="Recovery code"
            autoComplete="off"
            placeholder="abcde-fghjk"
            required
          />
        ) : (
          <AuthField
            key="code"
            id="code"
            name="code"
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            autoFocus
            required
          />
        )}
        <AuthActions>
          <Button
            type="submit"
            size="auth"
            className="shadow-card h-[52px] w-full text-base sm:h-[46px] sm:text-[15px]"
            disabled={pending}
            data-loading={pending || undefined}
          >
            {pending && <ButtonSpinner />}
            {pending ? "Checking…" : "Continue"}
          </Button>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => setRecovery((r) => !r)}
            >
              {recovery ? "Use my authenticator app" : "Use a recovery code"}
            </button>
            <button
              type="button"
              className="text-muted-foreground underline underline-offset-4"
              onClick={() => logOutAction()}
            >
              Log out
            </button>
          </div>
        </AuthActions>
      </form>
    </AuthCard>
  );
}
