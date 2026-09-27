import { notFound } from "next/navigation";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

// This is a placeholder landing spot for a newly created form. The full
// builder (question list, editable preview, config panel, autosave,
// logic, theming, publish) lands in the next milestone — see
// PROJECT_STATUS.md.
export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, workspace } = await getCurrentWorkspace();

  const { data: form } = await supabase
    .from("forms")
    .select("id, title, workspace_id")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .single();

  if (!form) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{form.title}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Builder coming next — this form and its draft schema were created successfully.
      </p>
    </div>
  );
}
