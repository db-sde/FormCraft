"use client";

import { useActionState } from "react";
import { AuthActions, AuthField, AuthNotice } from "@/components/auth/auth-ui";
import { Button } from "@/components/ui/button";
import { staffSignInAction, type FormState } from "../actions";

export function StaffSignInForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    staffSignInAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <AuthNotice tone="error">{state.error}</AuthNotice>}
      <AuthField
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="username"
        required
      />
      <AuthField
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      <AuthActions>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Continue"}
        </Button>
      </AuthActions>
    </form>
  );
}
