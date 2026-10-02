"use client";

import { useTransition } from "react";
import { History } from "lucide-react";
import { restoreVersionAction } from "@/app/(form)/forms/[id]/(sections)/settings/actions";
import type { VersionSummary } from "@/domains/forms/versions/history";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

/** Version history (P3.10): every published version, who published it,
 * how many responses it collected, and restoring one into the draft. */
export function VersionHistory({
  formId,
  versions,
}: {
  formId: string;
  versions: VersionSummary[];
}) {
  const [pending, start] = useTransition();
  return (
    <SettingsSection
      title="Version history"
      description="Each publish is kept as it was, and every response stays linked to the version it was given on. Restoring copies a version into your draft; publish it to make it live."
      wide
    >
      {versions.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing published yet.</p>
      ) : (
        <ol className="border-ink bg-card overflow-hidden rounded-lg border-[1.5px]">
          {versions.map((v) => (
            <li
              key={v.id}
              className="border-border flex flex-wrap items-center gap-3 border-b px-3.5 py-3 text-sm last:border-b-0"
            >
              <History className="text-muted-foreground size-4" aria-hidden />
              <b>Version {v.versionNumber}</b>
              {v.status === "published" && (
                <span className="rounded-full bg-[var(--chip-live-bg)] px-2 py-0.5 text-[11.5px] font-bold text-[var(--chip-live-fg)]">
                  Live
                </span>
              )}
              <span className="text-muted-foreground min-w-0 flex-1 text-[12.5px]">
                {v.publishedAt
                  ? new Date(v.publishedAt).toLocaleString("en", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : ""}
                {v.publishedBy ? ` · ${v.publishedBy}` : ""} · {v.responseCount} response
                {v.responseCount === 1 ? "" : "s"}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Replace your draft with version ${v.versionNumber}? Unpublished changes in the draft will be lost.`,
                    )
                  ) {
                    start(async () => {
                      const result = await restoreVersionAction(formId, v.id);
                      if (result.ok)
                        toast.success(`Version ${v.versionNumber} is now your draft.`);
                      else toast.error(result.message);
                    });
                  }
                }}
              >
                Restore to draft
              </Button>
            </li>
          ))}
        </ol>
      )}
    </SettingsSection>
  );
}
