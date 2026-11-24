"use client";

import { useActionState, useState, useTransition } from "react";
import { AuthActions, AuthField, AuthNotice } from "@/components/auth/auth-ui";
import { Button } from "@/components/ui/button";
import { startAuthenticatorAction, verifyCodeAction, type FormState } from "../actions";

export function CodeForm({ next, factorId }: { next?: string; factorId?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    verifyCodeAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <AuthNotice tone="error">{state.error}</AuthNotice>}
      {next && <input type="hidden" name="next" value={next} />}
      {factorId && <input type="hidden" name="factorId" value={factorId} />}
      <AuthField
        id="code"
        name="code"
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        autoFocus
        required
      />
      <AuthActions>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Checking…" : "Continue"}
        </Button>
      </AuthActions>
    </form>
  );
}

export function AuthenticatorSetup() {
  const [setup, setSetup] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!setup) {
    return (
      <div className="flex flex-col gap-4">
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await startAuthenticatorAction();
              if (result.ok) setSetup(result);
              else setError(result.error);
            })
          }
        >
          {pending ? "Starting…" : "Set up authenticator"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Scan this with your authenticator app, then enter the code it shows.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL from Supabase */}
      <img
        src={setup.qr}
        alt="QR code for your authenticator app"
        className="size-44 self-center bg-white p-2"
      />
      <p className="text-muted-foreground text-xs break-all">
        Can&apos;t scan? Enter this key: <code>{setup.secret}</code>
      </p>
      <CodeForm factorId={setup.factorId} />
    </div>
  );
}
