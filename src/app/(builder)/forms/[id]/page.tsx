import { notFound } from "next/navigation";
import { getDraftForEdit } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { FormBuilder } from "@/components/builder/form-builder";
import { saveDraftAction } from "./actions";

export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, workspace } = await getCurrentWorkspace();

  const draft = await getDraftForEdit(supabase, id, workspace.id);
  if (!draft) notFound();

  return (
    <FormBuilder
      formTitle={draft.formTitle}
      draftVersionId={draft.draftVersionId}
      initialRevision={draft.revision}
      initialSchema={draft.schema}
      onSave={saveDraftAction}
    />
  );
}
