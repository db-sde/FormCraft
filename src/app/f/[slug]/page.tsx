import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicFormBySlug } from "@/domains/forms";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FormRuntime } from "@/components/runtime/form-runtime";

// The public respondent runtime: no auth, reads only the currently
// published version (never the mutable draft — see ARCHITECTURE.md).
// Response persistence (autosave/submit) is a separate milestone; for
// now this renders a fully working, server-authoritative walkthrough
// of the published form using the same logic engine as the builder's
// preview, just without saving anything yet.
export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();

  const publicForm = await getPublicFormBySlug(supabase, slug);
  if (!publicForm) notFound();

  return (
    <div className="min-h-screen">
      <FormRuntime compiled={publicForm.compiled} />
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const publicForm = await getPublicFormBySlug(supabase, slug);

  return { title: publicForm?.compiled.schema.meta.title ?? "Form" };
}
