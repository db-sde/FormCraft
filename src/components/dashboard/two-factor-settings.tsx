"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import {
  confirmTwoFactorAction,
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
} from "@/app/(auth)/two-factor/actions";
import { createClient } from "@/lib/supabase/client";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

type Enrolment = { factorId: string; qr: string; secret: string };

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join("\n");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Save these recovery codes somewhere safe. Each one works once, if you lose your
        phone. <b>They won&apos;t be shown again.</b>
      </p>
      <ul className="border-ink bg-card grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border-[1.5px] p-4 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            navigator.clipboard.writeText(text).then(() => toast.success("Copied."))
          }
        >
          Copy
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([`${text}\n`], { type: "text/plain" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "formcraft-recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download
        </Button>
        <Button size="sm" onClick={onDone}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}

/** Settings → Account: two-factor authentication (P3.13) with an
 * authenticator app, and one-time recovery codes. */
export function TwoFactorSettings({
  enabled,
  remaining,
}: {
  enabled: boolean;
  remaining: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [disabling, setDisabling] = useState(false);

  const begin = () =>
    start(async () => {
      const supabase = createClient();
      // Drop any set-up that was started and never finished.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? [])
        if (f.factor_type === "totp" && f.status === "unverified")
          await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (error || !data) {
        toast.error("Couldn't start setting up two-factor authentication.");
        return;
      }
      setEnrolment({
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
    });

  const done = () => {
    setCodes(null);
    setEnrolment(null);
    router.refresh();
  };

  return (
    <SettingsSection
      title="Two-factor authentication"
      description="Ask for a code from an authenticator app (like 1Password, Google Authenticator or Authy) as well as your password when you log in."
    >
      {codes ? (
        <RecoveryCodes codes={codes} onDone={done} />
      ) : enrolment ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const result = await confirmTwoFactorAction(
                enrolment.factorId,
                code.trim(),
              );
              if (!result.ok) toast.error(result.message);
              else {
                setCode("");
                setCodes(result.recoveryCodes);
                toast.success("Two-factor authentication is on.");
              }
            });
          }}
        >
          <p className="text-sm">
            Scan this with your authenticator app, then enter the code it shows.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL from Supabase */}
          <img
            src={enrolment.qr}
            alt="QR code for your authenticator app"
            className="border-ink size-44 rounded-lg border-[1.5px] bg-white p-2"
          />
          <p className="text-muted-foreground text-[12.5px]">
            Can&apos;t scan it? Enter this key instead:{" "}
            <code className="text-foreground break-all">{enrolment.secret}</code>
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mfa-code">Code</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="max-w-40"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || code.trim().length < 6}>
              Turn on
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEnrolment(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : enabled ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-[var(--chip-live-dot)]" aria-hidden />
            <b>On.</b> {remaining} recovery code{remaining === 1 ? "" : "s"} left.
          </p>
          {disabling ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const result = await disableTwoFactorAction(code.trim());
                  if (!result.ok) toast.error(result.message);
                  else {
                    toast.success("Two-factor authentication is off.");
                    setCode("");
                    setDisabling(false);
                    router.refresh();
                  }
                });
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mfa-off-code">Code from your app</Label>
                <Input
                  id="mfa-off-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="max-w-40"
                />
              </div>
              <Button type="submit" variant="destructive" disabled={pending}>
                Turn off
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDisabling(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Replace your recovery codes? The old ones stop working.",
                    )
                  )
                    return;
                  start(async () => {
                    const result = await regenerateRecoveryCodesAction();
                    if (result.ok) setCodes(result.recoveryCodes);
                    else toast.error(result.message);
                  });
                }}
              >
                New recovery codes
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDisabling(true)}>
                Turn off
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div>
          <Button onClick={begin} disabled={pending}>
            <ShieldCheck aria-hidden /> Set up
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
