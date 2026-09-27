"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ResetPasswordInput, mapAuthError } from "@/domains/identity";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [sessionReady, setSessionReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
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
      if (data.session) {
        setSessionReady(true);
      } else {
        setLinkInvalid(true);
      }
    });
  }, [supabase]);

  async function onSubmit(values: ResetPasswordInput) {
    setServerError(null);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setServerError(mapAuthError(error.message).message);
      return;
    }
    router.push("/dashboard");
  }

  if (linkInvalid) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Link expired or invalid</CardTitle>
          <CardDescription>
            Request a new password reset link and try again.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>Make it at least 8 characters.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-destructive text-sm">{errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-destructive text-sm">{errors.confirmPassword.message}</p>
            )}
          </div>
          {serverError && <p className="text-destructive text-sm">{serverError}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={!sessionReady || isSubmitting}
          >
            {isSubmitting ? "Saving…" : "Save new password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
