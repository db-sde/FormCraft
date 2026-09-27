"use server";

import { redirect } from "next/navigation";
import { createFormWithDraft } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

export async function createFormAction(): Promise<void> {
  const { supabase, user, workspace } = await getCurrentWorkspace();
  const { id } = await createFormWithDraft(
    supabase,
    workspace.id,
    user.id,
    "Untitled form",
  );
  redirect(`/forms/${id}`);
}
