"use client";

import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { useArchiveForm } from "./use-archive-form";

/** Archive from the builder's Settings (developer spec item 4). */
export function ArchiveFormSection({
  formId,
  archived,
}: {
  formId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const archive = useArchiveForm(() =>
    archived ? router.refresh() : router.push("/dashboard?archived=1"),
  );
  return (
    <SettingsSection
      title={archived ? "This form is archived" : "Archive"}
      description={
        archived
          ? "Its link says it's no longer available and nothing is sent for it. Restore it to bring it back, unpublished, with its slug, responses and settings."
          : "Take the form out of use without deleting anything: it's unpublished, its link says it's no longer available, and its integrations stop. Responses and files are kept."
      }
    >
      {archive.dialog}
      <Button
        variant="outline"
        className="self-start"
        disabled={archive.pending}
        onClick={() => archive.run(formId, !archived)}
      >
        {archive.pending ? (
          <ButtonSpinner />
        ) : archived ? (
          <ArchiveRestore />
        ) : (
          <Archive />
        )}
        {archived ? "Restore form" : "Archive form"}
      </Button>
    </SettingsSection>
  );
}
