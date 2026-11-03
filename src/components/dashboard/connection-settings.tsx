"use client";

import { useState, useTransition } from "react";
import {
  connectHubspotAction,
  connectRazorpayAction,
  connectStripeAction,
  disconnectAction,
} from "@/app/(dashboard)/settings/connection-actions";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

type Status = { label: string | null; status: string } | null;

/** Settings → Connections: the workspace's Stripe, Razorpay and HubSpot accounts.
 * Secrets go to the server, are checked with the provider, and are
 * stored encrypted; only a masked label ever comes back. */
export function ConnectionSettings({
  stripe,
  razorpay,
  hubspot,
  payments,
  crm,
  isAdmin,
  stripeWebhookUrl,
  razorpayWebhookUrl,
}: {
  stripe: Status;
  razorpay: Status;
  hubspot: Status;
  payments: boolean;
  crm: boolean;
  isAdmin: boolean;
  stripeWebhookUrl: string;
  razorpayWebhookUrl: string;
}) {
  const [pending, start] = useTransition();
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [token, setToken] = useState("");
  const [rzpKeyId, setRzpKeyId] = useState("");
  const [rzpSecret, setRzpSecret] = useState("");
  const [rzpHook, setRzpHook] = useState("");
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

  const connected = (status: Status, provider: "stripe" | "razorpay" | "hubspot") =>
    status && (
      <div className="bg-background flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm">
        <span className="flex-1">
          Connected: <code className="font-mono text-[12.5px]">{status.label}</code>
          {status.status === "invalid" && (
            <b className="text-destructive ml-2">
              needs a new {provider === "hubspot" ? "token" : "key"}
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
              <code className="font-mono">checkout.session.*</code> and{" "}
              <code className="font-mono">charge.refunded</code>, then paste its signing
              secret and a secret (or restricted) key below.
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
        title="Razorpay"
        description={
          payments
            ? "Take payments in INR with your own Razorpay account — cards, UPI, netbanking and wallets, whichever Razorpay has activated for you. Respondents pay in Razorpay's checkout; their details never reach FormCraft."
            : "Payments are part of the Business plan."
        }
      >
        {connected(razorpay, "razorpay")}
        {payments && isAdmin && (
          <form
            className="flex flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => connectRazorpayAction(rzpKeyId, rzpSecret, rzpHook),
                () => {
                  setRzpKeyId("");
                  setRzpSecret("");
                  setRzpHook("");
                },
              );
            }}
          >
            <p className="text-muted-foreground text-[13px] leading-normal">
              In Razorpay → Account &amp; Settings → Webhooks, add{" "}
              <code className="font-mono">{razorpayWebhookUrl}</code> with the events{" "}
              <code className="font-mono">payment.captured</code>,{" "}
              <code className="font-mono">payment.failed</code>,{" "}
              <code className="font-mono">order.paid</code> and{" "}
              <code className="font-mono">refund.processed</code>, and a secret of your
              choice. Turn on automatic capture. Then paste an API key (Account &amp;
              Settings → API Keys) and that webhook secret below.
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="rzp-key">Key id</Label>
              <Input
                id="rzp-key"
                autoComplete="off"
                placeholder="rzp_live_…"
                value={rzpKeyId}
                onChange={(e) => setRzpKeyId(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rzp-secret">Key secret</Label>
              <Input
                id="rzp-secret"
                type="password"
                autoComplete="off"
                value={rzpSecret}
                onChange={(e) => setRzpSecret(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rzp-hook">Webhook secret</Label>
              <Input
                id="rzp-hook"
                type="password"
                autoComplete="off"
                value={rzpHook}
                onChange={(e) => setRzpHook(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="self-start"
              disabled={pending || !rzpKeyId || !rzpSecret || !rzpHook}
            >
              {pending && <ButtonSpinner />}
              {razorpay ? "Replace keys" : "Connect Razorpay"}
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
