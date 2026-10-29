"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import type { ThemeV1 } from "@/domains/forms/schema/v1";
import {
  Stage,
  StageButton,
  StageError,
  stageDescClass,
  stageTitleClass,
} from "@/components/runtime/stage";

/**
 * A password-protected form before it's unlocked (master spec F-48).
 * The server sends nothing of the form but its title and theme until
 * the password is right; then the unlock cookie is set and the page
 * renders again, this time with the form.
 */
export function PasswordGate({
  formId,
  title,
  theme,
  embedded = false,
}: {
  formId: string;
  title: string;
  theme: ThemeV1;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (!password || checking) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/responses/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId, password }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(
        res.status === 401
          ? "That password isn't right."
          : res.status === 429
            ? "Too many attempts. Please wait a few minutes and try again."
            : "Something went wrong. Please try again.",
      );
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    }
    setChecking(false);
  }

  return (
    <Stage
      theme={theme}
      className={embedded ? "min-h-[480px]" : "min-h-dvh"}
      data-testid="password-gate"
    >
      <LockKeyhole aria-hidden className="size-9 text-(--st-primary)" />
      <h1 className={stageTitleClass}>{title}</h1>
      <p className={stageDescClass}>
        This form is protected. Enter the password to open it.
      </p>
      <form onSubmit={unlock} className="flex flex-col gap-3">
        <label htmlFor="form-password" className="sr-only">
          Password
        </label>
        <input
          id="form-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "form-password-error" : undefined}
          className="h-(--st-btn-h) w-full max-w-sm rounded-(--st-br) border-[1.5px] border-(--st-line) bg-(--st-field) px-3.5 text-base outline-none focus:border-(--st-primary)"
        />
        {error && (
          <div id="form-password-error">
            <StageError>{error}</StageError>
          </div>
        )}
        <div>
          <StageButton
            type="submit"
            disabled={checking || !password}
            aria-busy={checking || undefined}
          >
            {checking ? "Checking…" : "Open form"}
          </StageButton>
        </div>
      </form>
    </Stage>
  );
}
