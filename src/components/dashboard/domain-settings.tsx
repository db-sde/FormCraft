"use client";

import { useState, useTransition } from "react";
import { Copy, Trash2 } from "lucide-react";
import {
  addDomainAction,
  removeDomainAction,
  setDomainDefaultFormAction,
  verifyDomainAction,
} from "@/app/(dashboard)/settings/domain-actions";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { cn } from "cn";

export type DomainView = {
  id: string;
  hostname: string;
  status: "pending" | "verified" | "error";
  defaultFormId: string | null;
  lastError: string | null;
  dns: { cname: { name: string; value: string }; txt: { name: string; value: string } };
};

const STATUS: Record<DomainView["status"], { label: string; className: string }> = {
  pending: {
    label: "Waiting for DNS",
    className: "bg-[var(--chip-draft-bg)] text-[var(--chip-draft-fg)]",
  },
  verified: {
    label: "Verified",
    className: "bg-[var(--chip-live-bg)] text-[var(--chip-live-fg)]",
  },
  error: {
    label: "Not working",
    className: "bg-[var(--alert-error-bg)] text-[var(--alert-error-fg)]",
  },
};

function Record({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2 text-[12.5px]">
      <b>{type}</b>
      <span className="min-w-0">
        <span className="text-muted-foreground block truncate font-mono">{name}</span>
        <span className="block truncate font-mono">{value}</span>
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`Copy the ${type} value`}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          toast.success("Copied.");
        }}
      >
        <Copy />
      </Button>
    </div>
  );
}

/** Settings → Domains (PRD P2.2): connect forms.example.com, follow the
 * DNS steps, check, choose what the bare domain opens. */
export function DomainSettings({
  domains,
  forms,
  isAdmin,
  limit,
}: {
  domains: DomainView[];
  forms: { id: string; title: string }[];
  isAdmin: boolean;
  limit: number | null;
}) {
  const [hostname, setHostname] = useState("");
  const [pending, start] = useTransition();
  const run = (work: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        if (result.message) toast.success(result.message);
      } else toast.error(result.message ?? "Something went wrong.");
    });

  return (
    <>
      <SettingsSection
        title="Custom domains"
        description={
          limit === 0
            ? "Serve your forms from your own domain, like forms.example.com. Part of the Business plan."
            : "Serve your forms from your own domain, like forms.example.com. Each form is at /its-link; choose one for the domain itself."
        }
        last={domains.length === 0}
      >
        {isAdmin && limit !== 0 && (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const result = await addDomainAction(hostname);
                if (result.ok) setHostname("");
                return result;
              });
            }}
          >
            <Input
              aria-label="Domain"
              required
              value={hostname}
              placeholder="forms.example.com"
              onChange={(e) => setHostname(e.target.value)}
              className="h-[38px] flex-1"
            />
            <Button type="submit" disabled={pending || !hostname.trim()}>
              {pending && <ButtonSpinner />}
              Add domain
            </Button>
          </form>
        )}
      </SettingsSection>
      {domains.map((d, i) => (
        <SettingsSection
          key={d.id}
          title={d.hostname}
          wide
          last={i === domains.length - 1}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[12px] font-bold",
                  STATUS[d.status].className,
                )}
              >
                {STATUS[d.status].label}
              </span>
              {d.lastError && d.status !== "verified" && (
                <span className="text-muted-foreground text-[12.5px]">{d.lastError}</span>
              )}
            </div>
            {d.status !== "verified" && (
              <div className="bg-background flex flex-col gap-2 rounded-sm p-3">
                <p className="text-[13px]">
                  Add these two records where your domain&apos;s DNS is managed:
                </p>
                <Record type="CNAME" name={d.dns.cname.name} value={d.dns.cname.value} />
                <Record type="TXT" name={d.dns.txt.name} value={d.dns.txt.value} />
              </div>
            )}
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={d.defaultFormId ?? "none"}
                  onValueChange={(v) =>
                    run(() => setDomainDefaultFormAction(d.id, v === "none" ? null : v))
                  }
                >
                  <SelectTrigger
                    className="h-[38px] w-[240px]"
                    aria-label={`What ${d.hostname} opens`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">The domain itself shows nothing</SelectItem>
                    {forms.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        Opens “{f.title}”
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => verifyDomainAction(d.id))}
                >
                  Check now
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${d.hostname}`}
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(`Disconnect ${d.hostname}? Its links stop working.`)
                    ) {
                      run(() => removeDomainAction(d.id));
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>
        </SettingsSection>
      ))}
    </>
  );
}
