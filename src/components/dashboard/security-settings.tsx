"use client";

import { useState, useTransition } from "react";
import {
  createScimTokenAction,
  deletePersonAction,
  exportPersonAction,
  findPersonAction,
  revokeScimTokenAction,
  updateSsoSettingsAction,
} from "@/app/(dashboard)/settings/security-actions";
import type { SsoSettings } from "@/domains/identity/sso";
import type { PersonResponse } from "@/domains/responses/privacy";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";

const CODE = "bg-muted rounded px-1.5 py-0.5 font-mono text-[12.5px] break-all";

function SsoSection({
  sso,
  allowed,
  supabaseUrl,
}: {
  sso: SsoSettings | null;
  allowed: boolean;
  supabaseUrl: string;
}) {
  const [pending, start] = useTransition();
  const save = (next: { enforced: boolean; defaultRole: "editor" | "viewer" }) =>
    start(async () => {
      const result = await updateSsoSettingsAction(next);
      if (result.ok) toast.success("Saved.");
      else toast.error(result.message);
    });

  return (
    <SettingsSection
      title="Single sign-on"
      description="Let people log in through your company's identity provider (SAML 2.0), and optionally require it."
      wide
    >
      {!allowed ? (
        <p className="text-muted-foreground text-sm">
          Single sign-on is included in the Enterprise plan.
        </p>
      ) : !sso ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Not connected yet. Connecting an identity provider is done by whoever runs
            this FormCraft installation. Give them your email domain and your
            provider&apos;s SAML metadata URL; your provider needs these in return:
          </p>
          <dl className="flex flex-col gap-1.5">
            <div>
              <dt className="text-muted-foreground text-[12.5px]">
                ACS (assertion consumer service) URL
              </dt>
              <dd className={CODE}>{supabaseUrl}/auth/v1/sso/saml/acs</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-[12.5px]">
                Entity ID / metadata
              </dt>
              <dd className={CODE}>{supabaseUrl}/auth/v1/sso/saml/metadata</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <p>
            Connected for <b>{sso.domain}</b>. People with that email domain can use “Log
            in with SSO” and join this workspace.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sso-role">Role for people who join through SSO</Label>
            <select
              id="sso-role"
              value={sso.defaultRole}
              disabled={pending}
              onChange={(e) =>
                save({
                  enforced: sso.enforced,
                  defaultRole: e.target.value as "editor" | "viewer",
                })
              }
              className="border-input bg-background h-9 max-w-48 rounded-md border px-2 text-sm"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id="sso-enforced"
              checked={sso.enforced}
              disabled={pending}
              onCheckedChange={(enforced) => {
                if (
                  enforced &&
                  !window.confirm(
                    "Require single sign-on? Members who log in with a password won't be able to open this workspace. The owner can always get in.",
                  )
                )
                  return;
                save({ enforced, defaultRole: sso.defaultRole });
              }}
            />
            <Label htmlFor="sso-enforced" className="flex flex-col items-start gap-0.5">
              Require single sign-on
              <span className="text-muted-foreground font-normal">
                Only sessions that came through your identity provider can open this
                workspace. The owner is exempt, so a broken provider can&apos;t lock you
                out.
              </span>
            </Label>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

function ScimSection({
  scim,
  allowed,
  appUrl,
}: {
  scim: { prefix: string; createdAt: string; lastUsedAt: string | null } | null;
  allowed: boolean;
  appUrl: string;
}) {
  const [pending, start] = useTransition();
  const [token, setToken] = useState<string | null>(null);
  return (
    <SettingsSection
      title="SCIM provisioning"
      description="Let your identity provider decide who may join this workspace, and remove people the moment they leave your directory."
      wide
    >
      {!allowed ? (
        <p className="text-muted-foreground text-sm">
          SCIM provisioning is included in the Enterprise plan.
        </p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            SCIM base URL: <span className={CODE}>{appUrl}/api/scim/v2</span>
          </p>
          {token ? (
            <div className="border-ink bg-card flex flex-col gap-2 rounded-lg border-[1.5px] p-3.5">
              <b>Copy this token now. It won&apos;t be shown again.</b>
              <span className={CODE}>{token}</span>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(token)
                      .then(() => toast.success("Copied."))
                  }
                >
                  Copy
                </Button>
              </div>
            </div>
          ) : scim ? (
            <p className="text-muted-foreground">
              Token <span className={CODE}>{scim.prefix}…</span> made{" "}
              {new Date(scim.createdAt).toLocaleDateString("en", { dateStyle: "medium" })}
              ,{" "}
              {scim.lastUsedAt
                ? `last used ${new Date(scim.lastUsedAt).toLocaleDateString("en", { dateStyle: "medium" })}`
                : "not used yet"}
              .
            </p>
          ) : (
            <p className="text-muted-foreground">No token yet.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (
                  scim &&
                  !window.confirm(
                    "Make a new token? The current one stops working at once.",
                  )
                )
                  return;
                start(async () => {
                  const result = await createScimTokenAction();
                  if (result.ok) setToken(result.token);
                  else toast.error(result.message);
                });
              }}
            >
              {scim || token ? "Replace token" : "Create token"}
            </Button>
            {(scim || token) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Turn SCIM off? Your identity provider's calls will fail.",
                    )
                  )
                    return;
                  start(async () => {
                    const result = await revokeScimTokenAction();
                    if (result.ok) {
                      setToken(null);
                      toast.success("SCIM is off.");
                    } else toast.error(result.message);
                  });
                }}
              >
                Turn off
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-[12.5px]">
            While a token exists, only people your directory lists as active can join
            through SSO; deactivating or removing someone there removes them here. Roles
            are set in Members.
          </p>
        </div>
      )}
    </SettingsSection>
  );
}

function PrivacySection() {
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<{
    email: string;
    responses: PersonResponse[];
  } | null>(null);
  const [confirmation, setConfirmation] = useState("");

  return (
    <SettingsSection
      title="Privacy requests"
      description="When someone asks what you hold about them, or asks you to erase it: find their responses by email, export them, or delete them."
      wide
      last
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const result = await findPersonAction(email);
            if (!result.ok) toast.error(result.message);
            else {
              setFound({
                email: email.trim().toLowerCase(),
                responses: result.responses,
              });
              setConfirmation("");
            }
          });
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="privacy-email">Their email address</Label>
          <Input
            id="privacy-email"
            type="email"
            value={email}
            placeholder="person@example.com"
            onChange={(e) => setEmail(e.target.value)}
            className="max-w-sm"
            required
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          Find their data
        </Button>
      </form>

      {found && (
        <div className="mt-4 flex flex-col gap-3 text-sm">
          {found.responses.length === 0 ? (
            <p>
              No responses in this workspace have <b>{found.email}</b> as an answer or in
              a contact step.
            </p>
          ) : (
            <>
              <p>
                <b>
                  {found.responses.length} response
                  {found.responses.length === 1 ? "" : "s"}
                </b>{" "}
                contain {found.email}
                {found.responses.length === 500 ? " (showing the first 500)" : ""}:
              </p>
              <ul className="border-ink bg-card max-h-56 overflow-auto rounded-lg border-[1.5px]">
                {found.responses.map((r) => (
                  <li
                    key={r.responseId}
                    className="border-border flex flex-wrap gap-x-3 border-b px-3.5 py-2 last:border-b-0"
                  >
                    <a
                      className="font-semibold underline underline-offset-2"
                      href={`/forms/${r.formId}/responses/${r.responseId}`}
                    >
                      {r.formTitle}
                    </a>
                    <span className="text-muted-foreground">
                      {r.status === "completed" ? "Submitted" : "Unfinished"} ·{" "}
                      {new Date(r.completedAt ?? r.startedAt).toLocaleDateString("en", {
                        dateStyle: "medium",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const result = await exportPersonAction(found.email);
                      if (!result.ok) return void toast.error(result.message);
                      const url = URL.createObjectURL(
                        new Blob([result.json], { type: "application/json" }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "formcraft-personal-data.json";
                      a.click();
                      URL.revokeObjectURL(url);
                    })
                  }
                >
                  Export as JSON
                </Button>
              </div>
              <form
                className="border-destructive/40 flex flex-wrap items-end gap-2 rounded-lg border p-3.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    const result = await deletePersonAction(found.email, confirmation);
                    if (!result.ok) toast.error(result.message);
                    else {
                      toast.success(
                        `Deleted ${result.deleted} response${result.deleted === 1 ? "" : "s"}.`,
                      );
                      setFound({ email: found.email, responses: [] });
                      setConfirmation("");
                    }
                  });
                }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor="privacy-confirm">
                    To delete these responses and their files for good, type the address
                    again
                  </Label>
                  <Input
                    id="privacy-confirm"
                    type="email"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    className="max-w-sm"
                  />
                </div>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={pending || confirmation.trim().toLowerCase() !== found.email}
                >
                  Delete their data
                </Button>
              </form>
            </>
          )}
          <p className="text-muted-foreground text-[12.5px]">
            Answers that are exactly this address, and contact steps, are searched; an
            address mentioned inside a longer answer isn&apos;t. Data already sent to your
            integrations (webhooks, Sheets, your CRM) isn&apos;t touched; remove it there
            too. Both actions are recorded in the audit log, without the address.
          </p>
        </div>
      )}
    </SettingsSection>
  );
}

/** Settings → Security (owner and admins): SSO (P3.12), SCIM (P3.18) and
 * privacy requests (P3.17). */
export function SecuritySettings({
  sso,
  ssoAllowed,
  scim,
  scimAllowed,
  appUrl,
  supabaseUrl,
}: {
  sso: SsoSettings | null;
  ssoAllowed: boolean;
  scim: { prefix: string; createdAt: string; lastUsedAt: string | null } | null;
  scimAllowed: boolean;
  appUrl: string;
  supabaseUrl: string;
}) {
  return (
    <div className="flex flex-col gap-[26px]">
      <SsoSection sso={sso} allowed={ssoAllowed} supabaseUrl={supabaseUrl} />
      <ScimSection scim={scim} allowed={scimAllowed} appUrl={appUrl} />
      <PrivacySection />
    </div>
  );
}
