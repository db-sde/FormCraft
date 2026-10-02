"use client";

import { useTransition } from "react";
import { setResponseRetentionAction } from "@/app/(dashboard)/settings/actions";
import { SettingsSection } from "@/components/dashboard/account-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";

const OPTIONS: [string, string][] = [
  ["keep", "Keep them"],
  ["30", "Delete after 30 days"],
  ["90", "Delete after 90 days"],
  ["180", "Delete after 6 months"],
  ["365", "Delete after a year"],
  ["730", "Delete after two years"],
];

/** Workspace retention for completed responses (P3.16). */
export function RetentionSettings({
  days,
  isAdmin,
}: {
  days: number | null;
  isAdmin: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <SettingsSection
      title="Response retention"
      description="Delete completed responses (and their files) automatically after a while. Runs daily and is recorded in the audit log. Copies already exported or sent to Sheets and webhooks aren't affected."
      wide
      last
    >
      <Select
        value={days === null ? "keep" : String(days)}
        disabled={!isAdmin || pending}
        onValueChange={(v) =>
          start(async () => {
            const result = await setResponseRetentionAction(
              v === "keep" ? null : Number(v),
            );
            if (result.ok) toast.success(result.message ?? "Saved.");
            else toast.error(result.message);
          })
        }
      >
        <SelectTrigger className="w-full sm:max-w-xs" aria-label="Response retention">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsSection>
  );
}
