"use client";

import { useState, useTransition } from "react";
import { Copy, Trash2 } from "lucide-react";
import {
  createApiKeyAction,
  revokeApiKeyAction,
} from "@/app/(dashboard)/settings/api-key-actions";
import type { ApiKeySummary } from "@/domains/api/keys";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";

/** Settings → API: keys for Zapier, Make and the API (Business). */
export function ApiKeySettings({
  keys,
  allowed,
  isAdmin,
  appUrl,
}: {
  keys: ApiKeySummary[];
  allowed: boolean;
  isAdmin: boolean;
  appUrl: string;
}) {
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <SettingsSection
        title="API keys"
        description={
          allowed
            ? "Connect Zapier, Make or your own code. A key can read this workspace's forms and responses and subscribe to new responses."
            : "API keys (for Zapier, Make and the API) are part of the Business plan."
        }
        last={keys.length === 0 && !created}
      >
        {allowed && isAdmin && (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const result = await createApiKeyAction(name);
                if (result.ok && result.key) {
                  setCreated(result.key);
                  setName("");
                } else if (!result.ok) toast.error(result.message);
              });
            }}
          >
            <Input
              aria-label="Key name"
              required
              value={name}
              maxLength={80}
              placeholder="Zapier"
              onChange={(e) => setName(e.target.value)}
              className="h-[38px] flex-1"
            />
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending && <ButtonSpinner />}
              Create key
            </Button>
          </form>
        )}
        {created && (
          <div className="flex flex-col gap-2 rounded-sm border-[1.5px] border-[var(--alert-success-border)] bg-[var(--alert-success-bg)] p-3 text-[13px] text-[var(--alert-success-fg)]">
            <b>Copy your key now — it won&apos;t be shown again.</b>
            <div className="flex items-center gap-2">
              <code
                className="min-w-0 flex-1 truncate font-mono"
                data-testid="new-api-key"
              >
                {created}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(created);
                  toast.success("Copied.");
                }}
              >
                <Copy /> Copy
              </Button>
            </div>
            <span>
              Base URL: <code className="font-mono">{appUrl}/api/v1</code> · send it as{" "}
              <code className="font-mono">Authorization: Bearer …</code>
            </span>
          </div>
        )}
      </SettingsSection>
      {keys.length > 0 && (
        <SettingsSection title="Keys in use" last>
          <ul className="flex flex-col gap-1.5">
            {keys.map((k) => (
              <li
                key={k.id}
                className="bg-background flex items-center gap-3 rounded-sm px-3 py-2 text-sm"
              >
                <b className="min-w-0 flex-1 truncate">{k.name}</b>
                <code className="text-muted-foreground font-mono text-[12.5px]">
                  {k.prefix}…
                </code>
                <span className="text-muted-foreground text-[12.5px]">
                  {k.lastUsedAt
                    ? `Used ${new Date(k.lastUsedAt).toLocaleDateString("en", { month: "short", day: "numeric" })}`
                    : "Never used"}
                </span>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Revoke ${k.name}`}
                    disabled={pending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Revoke “${k.name}”? Anything using it stops working.`,
                        )
                      ) {
                        start(async () => {
                          const result = await revokeApiKeyAction(k.id);
                          if (result.ok) toast.success("Key revoked.");
                          else toast.error(result.message);
                        });
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}
    </>
  );
}
