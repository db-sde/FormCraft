"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Send, Copy } from "lucide-react";
import type { WebhookEndpoint, DeliveryLogEntry } from "@/domains/webhooks";
import {
  createWebhookEndpointAction,
  setWebhookEnabledAction,
  deleteWebhookEndpointAction,
  sendTestDeliveryAction,
} from "@/app/(form)/forms/[id]/integrations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LocalTime } from "@/components/local-time";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATUS_VARIANT: Record<
  DeliveryLogEntry["status"],
  "default" | "secondary" | "destructive"
> = {
  succeeded: "default",
  pending: "secondary",
  failed: "destructive",
  exhausted: "destructive",
};

export function WebhooksPanel({
  formId,
  initialEndpoints,
  initialDeliveries,
}: {
  formId: string;
  initialEndpoints: WebhookEndpoint[];
  initialDeliveries: Record<string, DeliveryLogEntry[]>;
}) {
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [deliveries] = useState(initialDeliveries);
  const [url, setUrl] = useState("");
  const [revealedSecret, setRevealedSecret] = useState<{
    endpointId: string;
    secret: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingDelete, setPendingDelete] = useState<WebhookEndpoint | null>(null);

  function handleAdd() {
    startTransition(async () => {
      const result = await createWebhookEndpointAction(formId, url.trim());
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
          },
        ]);
        setRevealedSecret({ endpointId: result.id, secret: result.signingSecret });
        toast.success("Webhook added");
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
        toast.error("Couldn't update the webhook. Please try again.");
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
        toast("Webhook deleted");
      } catch {
        setEndpoints((eps) => [...eps, endpoint]);
        toast.error("Couldn't delete the webhook. Please try again.");
      }
    });
  }

  function handleTest(endpointId: string) {
    startTransition(async () => {
      const result = await sendTestDeliveryAction(endpointId);
      if (result.ok) toast.success("Test delivery succeeded");
      else toast.error(`Test delivery failed${result.error ? `: ${result.error}` : ""}`);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {revealedSecret && (
        <Alert>
          <AlertTitle>Signing secret</AlertTitle>
          <AlertDescription>
            <p className="mb-2">
              Save this now — it won&apos;t be shown again. Use it to verify the{" "}
              <code>X-FormCraft-Signature</code> header on incoming requests.
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-muted rounded px-2 py-1 text-xs">
                {revealedSecret.secret}
              </code>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(revealedSecret.secret);
                  toast("Copied");
                }}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add endpoint</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) handleAdd();
            }}
          >
            <Input
              type="url"
              inputMode="url"
              aria-label="Webhook URL"
              placeholder="https://example.com/webhook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button type="submit" disabled={pending || !url.trim()}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {endpoints.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No webhooks configured. Add one above to have completed responses posted to your
          own server.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {endpoints.map((endpoint) => (
            <Card key={endpoint.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="min-w-0">
                  <CardTitle className="truncate font-mono text-sm font-normal">
                    {endpoint.url}
                  </CardTitle>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={endpoint.enabled}
                    onCheckedChange={(checked) => handleToggle(endpoint.id, checked)}
                    aria-label="Enabled"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(endpoint.id)}
                    disabled={pending}
                  >
                    <Send className="size-3.5" /> Test
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setPendingDelete(endpoint)}
                    aria-label="Delete webhook"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {(deliveries[endpoint.id]?.length ?? 0) === 0 ? (
                  <p className="text-muted-foreground text-xs">No deliveries yet.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {deliveries[endpoint.id]!.slice(0, 5).map((delivery) => (
                      <div
                        key={delivery.id}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-muted-foreground">
                          <LocalTime iso={delivery.createdAt} />
                        </span>
                        <div className="flex items-center gap-2">
                          {delivery.attemptCount > 1 && (
                            <span className="text-muted-foreground">
                              attempt {delivery.attemptCount}
                            </span>
                          )}
                          <Badge variant={STATUS_VARIANT[delivery.status]}>
                            {delivery.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              Completed responses will stop being sent to{" "}
              <span className="font-mono break-all">{pendingDelete?.url}</span>. Its
              signing secret can&apos;t be recovered — adding the URL again creates a new
              one.
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
