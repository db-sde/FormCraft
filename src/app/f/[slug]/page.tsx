import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { getPublicFormBySlug } from "@/domains/forms";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicFormRuntime } from "./public-form-runtime";

/** One lookup per request, shared by the page and its metadata. */
const loadPublicForm = cache(async (slug: string) => {
  const supabase = await createServerSupabaseClient();
  return getPublicFormBySlug(supabase, slug);
});

// The public respondent runtime: no auth, reads only the currently
// published version (never the mutable draft — see ARCHITECTURE.md).
// PublicFormRuntime owns the response-lifecycle API calls (start/
// autosave/complete) and localStorage-based resume; FormRuntime
// itself (shared with the builder's Preview dialog) stays a pure,
// network-free renderer.
export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ embed?: string }>;
}) {
  const { slug } = await params;
  // Set by the embed code on the Share page.
  const embedded = (await searchParams).embed === "1";
  const publicForm = await loadPublicForm(slug);
  if (!publicForm) notFound();

  // A view is counted on every render of this page, including a
  // refresh mid-response — distinct from form_started, which only
  // fires once per response row (see /api/responses/start). Analytics
  // must never affect the page render, so both calls are best-effort.
  after(async () => {
    const admin = createAdminClient();
    const distinctId = crypto.randomUUID();
    try {
      await recordAnalyticsEvent(admin, {
        formId: publicForm.formId,
        eventType: "form_viewed",
        metadata: { embedded },
      });
    } catch {
      // Swallow — see comment above.
    }
    await captureServerEvent({
      distinctId,
      event: "form_viewed",
      properties: { formId: publicForm.formId, embedded },
    });
  });

  return (
    <div className={embedded ? undefined : "min-h-screen"}>
      <PublicFormRuntime
        formId={publicForm.formId}
        formVersionId={publicForm.formVersionId}
        compiled={publicForm.compiled}
        savesProgress={publicForm.savePartialResponses}
        embedded={embedded}
      />
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const publicForm = await loadPublicForm(slug);
  if (!publicForm) return { title: "Form unavailable", robots: { index: false } };

  const { title, description } = publicForm.compiled.schema.meta;
  // Shared form links get a real preview card in chat apps/social.
  return { title, description, openGraph: { title, description } };
}
