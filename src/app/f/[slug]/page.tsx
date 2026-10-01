import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import { getPublicFormBySlug } from "@/domains/forms";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isLikelyBot } from "@/lib/http/bots";
import { PublicFormRuntime } from "./public-form-runtime";

/** One lookup per request, shared by the page and its metadata. */
const loadPublicForm = cache(async (slug: string) => {
  // Read through the server: forms and versions aren't readable by
  // anonymous or other signed-in users at all (row-level security), so
  // a stranger can't enumerate drafts or other tenants' form ids.
  return getPublicFormBySlug(createAdminClient(), slug);
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
  // refresh mid-response — distinct from a start, which is the first
  // interaction (see /api/responses/start). Not counted: crawlers and
  // link-preview fetchers (sharing a link in chat apps makes their
  // servers load it), and members of the form's own workspace looking
  // at their live form. Request details must be read before after();
  // analytics must never affect the page render, so everything after
  // that is best-effort.
  const userAgent = (await headers()).get("user-agent");
  const viewer = (await (await createServerSupabaseClient()).auth.getUser()).data.user;
  const countsAsView = !isLikelyBot(userAgent);

  after(async () => {
    if (!countsAsView) return;
    const admin = createAdminClient();
    try {
      if (viewer) {
        const { data: form } = await admin
          .from("forms")
          .select("workspace_id")
          .eq("id", publicForm.formId)
          .single();
        const { data: membership } = form
          ? await admin
              .from("workspace_members")
              .select("user_id")
              .eq("workspace_id", form.workspace_id)
              .eq("user_id", viewer.id)
              .maybeSingle()
          : { data: null };
        if (membership) return; // the creator checking their own form
      }
      await recordAnalyticsEvent(admin, {
        formId: publicForm.formId,
        eventType: "form_viewed",
        metadata: { embedded },
      });
    } catch {
      // Swallow — see comment above.
    }
    await captureServerEvent({
      distinctId: crypto.randomUUID(),
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
  if (!publicForm)
    return { title: { absolute: "This form isn't available" }, robots: { index: false } };

  const { title, description } = publicForm.compiled.schema.meta;
  // Respondent tabs show only the form's title (Part 8 §4) — it never
  // changes per question, so it doesn't reveal progress or answers.
  // Shared form links get a real preview card in chat apps/social.
  return { title: { absolute: title }, description, openGraph: { title, description } };
}
