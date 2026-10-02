"use client";

import { useState, useTransition } from "react";
import {
  connectHubspotAction,
  connectStripeAction,
  disconnectAction,
} from "@/app/(dashboard)/settings/connection-actions";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

type Status = { label: string | null; status: string } | null;

/** Settings → Connections: the workspace's Stripe and HubSpot accounts.
 * Secrets go to the server, are checked with the provider, and are
 * stored encrypted; only a masked label ever comes back. */
export function ConnectionSettings({
  stripe,
  hubspot,
  payments,
  crm,
  isAdmin,
  stripeWebhookUrl,
}: {
  stripe: Status;
  hubspot: Status;
  payments: boolean;
  crm: boolean;
  isAdmin: boolean;
  stripeWebhookUrl: string;
}) {
  const [pending, start] = useTransition();
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [token, setToken] = useState("");
  const run = (
    work: () => Promise<{ ok: boolean; message?: string }>,
    reset?: () => void,
  ) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(result.message ?? "Done.");
        reset?.();
      } else toast.error(result.message ?? "Something went wrong.");
    });

  const connected = (status: Status, provider: "stripe" | "hubspot") =>
    status && (
      <div className="bg-background flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm">
        <span className="flex-1">
          Connected: <code className="font-mono text-[12.5px]">{status.label}</code>
          {status.status === "invalid" && (
            <b className="text-destructive ml-2">
              needs a new {provider === "stripe" ? "key" : "token"}
            </b>
          )}
        </span>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => disconnectAction(provider))}
          >
            Disconnect
          </Button>
        )}
      </div>
    );

  return (
    <>
      <SettingsSection
        title="Stripe"
        description={
          payments
            ? "Take payments in forms with your own Stripe account. Respondents pay on Stripe; card details never reach FormCraft."
            : "Payments are part of the Business plan."
        }
      >
        {connected(stripe, "stripe")}
        {payments && isAdmin && (
          <form
            className="flex flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => connectStripeAction(secretKey, webhookSecret),
                () => {
                  setSecretKey("");
                  setWebhookSecret("");
                },
              );
            }}
          >
            <p className="text-muted-foreground text-[13px] leading-normal">
              In Stripe → Developers → Webhooks, add an endpoint for{" "}
              <code className="font-mono">{stripeWebhookUrl}</code> with the events{" "}
              <code className="font-mono">checkout.session.*</code>, then paste its
              signing secret and a secret (or restricted) key below.
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="stripe-key">Secret key</Label>
              <Input
                id="stripe-key"
                type="password"
                autoComplete="off"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="stripe-whsec">Webhook signing secret</Label>
              <Input
                id="stripe-whsec"
                type="password"
                autoComplete="off"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="self-start"
              disabled={pending || !secretKey || !webhookSecret}
            >
              {pending && <ButtonSpinner />}
              {stripe ? "Replace keys" : "Connect Stripe"}
            </Button>
          </form>
        )}
      </SettingsSection>
      <SettingsSection
        title="HubSpot"
        description={
          crm
            ? "Create or update a HubSpot contact for each response, with the fields you map on each form's Integrations page."
            : "CRM integrations are part of the Business plan."
        }
        last
      >
        {connected(hubspot, "hubspot")}
        {crm && isAdmin && (
          <form
            className="flex flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => connectHubspotAction(token),
                () => setToken(""),
              );
            }}
          >
            <p className="text-muted-foreground text-[13px] leading-normal">
              In HubSpot → Settings → Integrations → Private apps, create an app with the
              contacts read and write scopes, and paste its access token.
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="hubspot-token">Access token</Label>
              <Input
                id="hubspot-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <Button type="submit" className="self-start" disabled={pending || !token}>
              {pending && <ButtonSpinner />}
              {hubspot ? "Replace token" : "Connect HubSpot"}
            </Button>
          </form>
        )}
      </SettingsSection>
    </>
  );
}
