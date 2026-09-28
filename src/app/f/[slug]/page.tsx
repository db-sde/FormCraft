import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicFormBySlug } from "@/domains/forms";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PublicFormRuntime } from "./public-form-runtime";

// The public respondent runtime: no auth, reads only the currently
// published version (never the mutable draft — see ARCHITECTURE.md).
// PublicFormRuntime owns the response-lifecycle API calls (start/
// autosave/complete) and localStorage-based resume; FormRuntime
// itself (shared with the builder's Preview dialog) stays a pure,
// network-free renderer.
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
      <PublicFormRuntime formId={publicForm.formId} compiled={publicForm.compiled} />
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
