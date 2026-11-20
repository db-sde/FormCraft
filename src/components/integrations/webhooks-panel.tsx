"use client";

import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { Check, Copy, KeyRound, RotateCw, Trash2, Webhook } from "lucide-react";
import type { WebhookEndpoint, DeliveryLogEntry } from "@/domains/webhooks";
import {
  createWebhookEndpointAction,
  setWebhookEnabledAction,
  deleteWebhookEndpointAction,
  sendTestDeliveryAction,
  rotateWebhookSecretAction,
} from "@/app/(form)/forms/[id]/(sections)/integrations/actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { LocalTime } from "@/components/local-time";
import { DeliveryRow } from "./delivery-row";
import { WebhookEventsEditor } from "./webhook-events-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Webhook endpoints (Part 5 §5.7): add, one-time secret, enable,
 * test, delete, and each endpoint's last five deliveries. */
export function WebhooksPanel({
  formId,
  initialEndpoints,
  initialDeliveries,
  keepsUnfinished = false,
}: {
  formId: string;
  initialEndpoints: WebhookEndpoint[];
  initialDeliveries: Record<string, DeliveryLogEntry[]>;
  /** Whether the form keeps unfinished responses (F-53's privacy switch). */
  keepsUnfinished?: boolean;
}) {
  // A plain webhook, or an n8n workflow's Webhook node (F-49).
  const [kind, setKind] = useState<"webhook" | "n8n">("webhook");
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [deliveries] = useState(initialDeliveries);
  const [url, setUrl] = useState("");
  const [revealedSecret, setRevealedSecret] = useState<{
    endpointId: string;
    secret: string;
  } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [adding, startAdding] = useTransition();
  const [testing, setTesting] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [pendingDelete, setPendingDelete] = useState<WebhookEndpoint | null>(null);

  function handleAdd() {
    startAdding(async () => {
      const result = await createWebhookEndpointAction(formId, url.trim(), kind);
      if (result.ok) {
        setUrl("");
        setEndpoints((eps) => [
          ...eps,
          {
            id: result.id,
            formId,
            url: result.url,
            enabled: true,
            createdAt: result.createdAt,
            kind,
            questionIds: [],
            events: ["response.completed"],
            abandonAfterMinutes: 30,
          },
        ]);
        setSecretCopied(false);
        setRevealedSecret({ endpointId: result.id, secret: result.signingSecret });
        toast.success(kind === "n8n" ? "n8n workflow connected." : "Webhook added.", {
          description: "Save the signing secret below.",
        });
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleToggle(endpointId: string, enabled: boolean) {
    const setEnabled = (value: boolean) =>
      setEndpoints((eps) =>
        eps.map((e) => (e.id === endpointId ? { ...e, enabled: value } : e)),
      );
    setEnabled(enabled);
    startTransition(async () => {
      try {
        await setWebhookEnabledAction(formId, endpointId, enabled);
      } catch {
        setEnabled(!enabled);
        toast.error("Couldn't update the webhook.", { description: "Try again." });
      }
    });
  }

  function handleDelete(endpoint: WebhookEndpoint) {
    setPendingDelete(null);
    setEndpoints((eps) => eps.filter((e) => e.id !== endpoint.id));
    setRevealedSecret((r) => (r?.endpointId === endpoint.id ? null : r));
    startTransition(async () => {
      try {
        await deleteWebhookEndpointAction(formId, endpoint.id);
        toast.success("Webhook deleted.");
      } catch {
        setEndpoints((eps) => [...eps, endpoint]);
        toast.error("Couldn't delete the webhook.", { description: "Try again." });
      }
    });
  }

  async function handleTest(endpointId: string) {
    setTesting(endpointId);
    try {
      const result = await sendTestDeliveryAction(endpointId);
      if (result.ok) toast.success("Test delivery succeeded.");
      else
        toast.error("Test delivery failed:", {
          description: result.error ?? "no response.",
        });
    } finally {
      setTesting(null);
    }
  }

  const [pendingRotate, setPendingRotate] = useState<WebhookEndpoint | null>(null);

  function handleRotate(endpoint: WebhookEndpoint) {
    setPendingRotate(null);
    startTransition(async () => {
      const result = await rotateWebhookSecretAction(formId, endpoint.id);
      if (!result.ok) {
        toast.error("Couldn't make a new secret.", { description: result.message });
        return;
      }
      setSecretCopied(false);
      setRevealedSecret({ endpointId: endpoint.id, secret: result.signingSecret });
      toast.success("New signing secret made.", {
        description: "The old one has stopped working. Save the new one below.",
      });
    });
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
    } catch {
      toast.error("Couldn't copy.", {
        description: "Select the secret and copy it yourself.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div
        role="radiogroup"
        aria-label="Send to"
        className="border-input bg-background flex gap-0.5 self-start rounded-[7px] border-[1.5px] p-[2px]"
      >
        {(
          [
            ["webhook", "Your server"],
            ["n8n", "n8n workflow"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => setKind(value)}
            className={
              kind === value
                ? "bg-secondary text-secondary-foreground rounded-[5px] px-2.5 py-[3px] text-[12.5px] font-semibold"
                : "hover:bg-hover-wash rounded-[5px] px-2.5 py-[3px] text-[12.5px] font-semibold"
            }
          >
            {label}
          </button>
        ))}
      </div>
      {kind === "n8n" && (
        <p className="text-muted-foreground text-[13px] leading-[1.5]">
          In n8n, add a <b>Webhook</b> trigger (POST), copy its <b>Production URL</b> and
          paste it below. Then check each request&apos;s signature with the secret we show
          you. Our{" "}
          <a href="/n8n/formcraft-sample-workflow.json" download className="underline">
            sample workflow
          </a>{" "}
          does it for you: import it, paste the secret into its second step, and switch
          the workflow on.
        </p>
      )}
      <form
        className="border-ink bg-card flex gap-2.5 rounded-lg border-[1.5px] p-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) handleAdd();
        }}
      >
        <Input
          type="url"
          inputMode="url"
          aria-label={kind === "n8n" ? "n8n Webhook URL" : "Webhook URL"}
          placeholder={
            kind === "n8n"
              ? "https://your-n8n.example.com/webhook/…"
              : "https://example.com/webhook"
          }
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="font-mono text-[13.5px]"
        />
        <Button
          type="submit"
          className="h-[42px] px-[18px]"
          data-loading={adding || undefined}
          disabled={adding || !url.trim()}
        >
          {adding && <ButtonSpinner />}
          {adding ? "Adding…" : "Add"}
        </Button>
      </form>

      {revealedSecret && (
        <div className="flex flex-col gap-2.5 rounded-lg border-[1.5px] border-[#2b2118] bg-[#2b2118] px-4 py-3.5 text-[#fffaf1] shadow-[3px_3px_0_#f2b233]">
          <div className="flex items-center gap-2.5">
            <KeyRound className="size-[18px] shrink-0 text-[#f2b233]" />
            <b className="text-[15px]">
              Signing secret. Save this now, it won&apos;t be shown again.
            </b>
          </div>
          <div className="flex h-[42px] items-center overflow-hidden rounded-sm border-[1.5px] border-[#6f6254]">
            <code className="min-w-0 flex-1 truncate px-3 font-mono text-[13.5px] text-[#f2b233]">
              {revealedSecret.secret}
            </code>
            <button
              type="button"
              onClick={() => void copySecret(revealedSecret.secret)}
              className={
                secretCopied
                  ? "flex h-full items-center gap-1.5 bg-[#dcf1e3] px-3.5 text-[13px] font-bold text-[#1f6b42]"
                  : "flex h-full items-center gap-1.5 bg-[#f2b233] px-3.5 text-[13px] font-bold text-[#2b2118]"
              }
            >
              {secretCopied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {secretCopied ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="text-[12.5px] text-[#cdbda4]">
            Use it to check the <span className="font-mono">X-FormCraft-Signature</span>{" "}
            header on each request: an HMAC-SHA256 of the timestamp, a dot and the body.
            Reject requests more than five minutes old.
          </span>
        </div>
      )}

      {endpoints.length === 0 ? (
        <div className="border-ink bg-card flex flex-col items-start gap-1 rounded-lg border-[1.5px] border-dashed p-[18px]">
          <b className="font-heading text-base">No webhooks configured</b>
          <span className="text-muted-foreground text-sm">
            Add an HTTPS endpoint above. We&apos;ll sign each request so you know it came
            from us.
          </span>
        </div>
      ) : (
        endpoints.map((endpoint) => {
          const log = deliveries[endpoint.id] ?? [];
          return (
            <div
              key={endpoint.id}
              className="border-ink bg-card shadow-card rounded-lg border-[1.5px]"
            >
              <div className="border-border flex flex-wrap items-center gap-3 border-b-[1.5px] px-3.5 py-3">
                {endpoint.kind === "n8n" && (
                  <span className="rounded-full bg-[#ffe9e3] px-2 py-0.5 text-[11.5px] font-bold text-[#a2361b]">
                    n8n
                  </span>
                )}
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[13.5px]"
                  title={endpoint.url}
                >
                  {endpoint.url}
                </span>
                <label className="text-muted-foreground flex items-center gap-2 text-[13px] font-semibold">
                  {endpoint.enabled ? "Enabled" : "Paused"}
                  <Switch
                    checked={endpoint.enabled}
                    onCheckedChange={(checked) => handleToggle(endpoint.id, checked)}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-[34px]"
                  data-loading={testing === endpoint.id || undefined}
                  onClick={() => void handleTest(endpoint.id)}
                  disabled={testing !== null}
                >
                  {testing === endpoint.id && <ButtonSpinner />}
                  {testing === endpoint.id ? "Testing…" : "Test"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-[34px]"
                  onClick={() => setPendingRotate(endpoint)}
                  aria-label={`New signing secret for ${host(endpoint.url)}`}
                  title="New signing secret"
                >
                  <RotateCw className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive size-[34px]"
                  onClick={() => setPendingDelete(endpoint)}
                  aria-label={`Delete webhook ${host(endpoint.url)}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <WebhookEventsEditor
                formId={formId}
                endpointId={endpoint.id}
                events={endpoint.events}
                abandonAfterMinutes={endpoint.abandonAfterMinutes}
                keepsUnfinished={keepsUnfinished}
                onSaved={(events, abandonAfterMinutes) =>
                  setEndpoints((eps) =>
                    eps.map((e) =>
                      e.id === endpoint.id ? { ...e, events, abandonAfterMinutes } : e,
                    ),
                  )
                }
              />
              <div className="flex flex-col gap-0.5 px-3.5 pt-2.5 pb-3">
                <span className="text-muted-foreground pb-1 text-[11px] font-bold tracking-[0.08em] uppercase">
                  Last 5 deliveries
                </span>
                {log.length === 0 ? (
                  <span className="text-muted-foreground py-2 text-[13.5px]">
                    No deliveries yet. The next completed response will show up here.
                  </span>
                ) : (
                  log.slice(0, 5).map((delivery) => (
                    <DeliveryRow
                      key={delivery.id}
                      when={<LocalTime iso={delivery.createdAt} variant="day" />}
                      detail={[
                        // Every delivery names its event, completed too
                        // (QA FC11-04).
                        delivery.eventType.replace("response.", ""),
                        delivery.attemptCount > 1
                          ? `attempt ${delivery.attemptCount}`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      error={delivery.status !== "succeeded" ? delivery.lastError : null}
                      status={delivery.status}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })
      )}

      <AlertDialog
        open={pendingRotate !== null}
        onOpenChange={(open) => !open && setPendingRotate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <KeyRound />
            </AlertDialogMedia>
            <AlertDialogTitle>Make a new signing secret?</AlertDialogTitle>
            <AlertDialogDescription>
              The current secret for {pendingRotate && host(pendingRotate.url)} stops
              working straight away, so update your receiver with the new one. Do this if
              the old one may have leaked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingRotate && handleRotate(pendingRotate)}
            >
              Make a new secret
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Webhook />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete this webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              Deliveries to {pendingDelete && host(pendingDelete.url)} stop right away,
              and its signing secret can&apos;t be recovered. You&apos;d need a new
              endpoint and secret to start again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingDelete && handleDelete(pendingDelete)}
            >
              Delete webhook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
