"use client";

import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { saveEmailBrandingAction } from "@/app/(dashboard)/settings/plan-actions";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { ImageUploadField } from "@/components/builder/image-upload-field";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notOnPlanMessage } from "@/domains/billing/entitlements";

type Branding = {
  accentColor?: string;
  logoUrl?: string;
  footer?: string;
  fromName?: string;
};

/** Email branding (pricing doc: custom email templates, Starter and up). */
export function EmailBrandingSettings({
  workspaceId,
  initial,
  allowed,
  isAdmin,
}: {
  workspaceId: string;
  initial: Branding;
  allowed: boolean;
  isAdmin: boolean;
}) {
  const [accentColor, setAccentColor] = useState(initial.accentColor ?? "");
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [footer, setFooter] = useState(initial.footer ?? "");
  const [fromName, setFromName] = useState(initial.fromName ?? "");
  const [saving, start] = useTransition();
  const disabled = !allowed || !isAdmin;

  return (
    <SettingsSection
      title="Email branding"
      description="Your logo, colour, footer and sender name on confirmation, notification, rule and booking emails. Each email's wording is set where it always was."
    >
      {!allowed && (
        <p className="text-muted-foreground text-sm">
          {notOnPlanMessage("email_templates")}
        </p>
      )}
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="eb-name">Sender name</Label>
          <Input
            id="eb-name"
            maxLength={60}
            placeholder="Acme Events"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="eb-accent">Button colour</Label>
          <div className="flex items-center gap-2">
            <input
              aria-label="Pick a button colour"
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#f2b233"}
              onChange={(e) => setAccentColor(e.target.value)}
              className="border-input h-9 w-12 rounded-sm border-[1.5px]"
            />
            <Input
              id="eb-accent"
              maxLength={7}
              placeholder="#f2b233"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
            />
          </div>
        </div>
        {!disabled && (
          <ImageUploadField
            label="Logo (shown 32px tall)"
            noun="a logo"
            workspaceId={workspaceId}
            formId="email-branding"
            value={logoUrl}
            onChange={setLogoUrl}
          />
        )}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="eb-footer">Footer</Label>
          <Input
            id="eb-footer"
            maxLength={300}
            placeholder="Acme Events · 12 Park Street, Pune"
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
          />
        </div>
      </fieldset>
      {!disabled && (
        <Button
          className="self-start"
          disabled={saving}
          onClick={() =>
            start(async () => {
              const result = await saveEmailBrandingAction({
                accentColor: accentColor.trim() || undefined,
                logoUrl,
                footer: footer.trim() || undefined,
                fromName: fromName.trim() || undefined,
              });
              if (result.ok) toast.success("Email branding saved.");
              else toast.error("Couldn't save that.", { description: result.message });
            })
          }
        >
          {saving && <ButtonSpinner />} Save email branding
        </Button>
      )}
    </SettingsSection>
  );
}
