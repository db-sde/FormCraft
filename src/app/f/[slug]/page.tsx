import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { getPublicFormBySlug } from "@/domains/forms";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isLikelyBot } from "@/lib/http/bots";
import { PublicFormRuntime } from "./public-form-runtime";
import { TrackingScripts } from "./tracking-scripts";
import { CUSTOM_DOMAIN_HEADER } from "@/lib/http/custom-domain";
import { resolveResumeToken, RESUME_PARAM } from "@/domains/responses/resume";
import { getWorkspacePlan } from "@/domains/billing/entitlements";
import { themeForPlan } from "@/domains/themes/fonts";
import { formLanguages, LANGUAGES, pickLanguage } from "@/domains/forms/i18n";
import {
  assignArm,
  runningExperimentFor,
  VISITOR_COOKIE,
  VISITOR_ID_PATTERN,
} from "@/domains/experiments";
import { knownAnswersFor } from "@/domains/responses/profile";

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
  searchParams: Promise<{ embed?: string; lang?: string; [RESUME_PARAM]?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  // Set by the embed code on the Share page.
  const embedded = query.embed === "1";
  const linked = await loadPublicForm(slug);
  if (!linked) notFound();

  // On a custom domain (P2.2) only that workspace's forms are served.
  const domainId = (await headers()).get(CUSTOM_DOMAIN_HEADER);
  if (domainId) {
    const { data: domain } = await createAdminClient()
      .from("custom_domains")
      .select("workspace_id, status")
      .eq("id", domainId)
      .maybeSingle();
    if (
      !domain ||
      domain.status !== "verified" ||
      domain.workspace_id !== linked.workspaceId
    ) {
      notFound();
    }
  }

  // A resume link (P2.8) opens the same unfinished response; a link that
  // no longer works starts fresh, with a note saying why.
  // Plan features are decided here, on the server (P2.1, P2.22).
  const { entitlements } = await getWorkspacePlan(
    createAdminClient(),
    linked.workspaceId,
  );

  // An A/B test on this link (P3.9) sends some visitors to version B —
  // the same one every time, by their visitor id. Resume links carry
  // their own form's slug, so they skip the split.
  let publicForm = linked;
  let experimentId: string | undefined;
  const visitorId = (await cookies()).get(VISITOR_COOKIE)?.value ?? "";
  if (
    entitlements.ab_testing &&
    !query[RESUME_PARAM] &&
    VISITOR_ID_PATTERN.test(visitorId)
  ) {
    const admin = createAdminClient();
    const test = await runningExperimentFor(admin, linked.formId);
    if (test && assignArm(test.id, visitorId, test.split) === "b") {
      const { data: variant } = await admin
        .from("forms")
        .select("slug")
        .eq("id", test.variantFormId)
        .maybeSingle();
      const served = variant ? await loadPublicForm(variant.slug) : null;
      // If B has gone (unpublished or deleted), A is served untagged
      // rather than skewing the test.
      if (served && served.workspaceId === linked.workspaceId) {
        publicForm = served;
        experimentId = test.id;
      }
    } else if (test) {
      experimentId = test.id;
    }
  }
  const schema = publicForm.compiled.schema;
  const compiled = {
    ...publicForm.compiled,
    schema: {
      ...schema,
      theme: themeForPlan(
        schema.theme,
        entitlements.custom_fonts,
        process.env.NEXT_PUBLIC_SUPABASE_URL,
      ),
    },
  };

  // Progressive profiling: answers this visitor already gave to "ask
  // once" questions on this workspace's forms.
  const known = VISITOR_ID_PATTERN.test(visitorId)
    ? await knownAnswersFor(
        createAdminClient(),
        publicForm.workspaceId,
        visitorId,
        compiled.schema,
      )
    : {};

  const resume =
    typeof query[RESUME_PARAM] === "string"
      ? await resolveResumeToken(createAdminClient(), query[RESUME_PARAM], publicForm)
      : null;

  // A view is counted on every render of this page, including a
  // refresh mid-response — distinct from a start, which is the first
  // interaction (see /api/responses/start). Not counted: crawlers and
  // link-preview fetchers (sharing a link in chat apps makes their
  // servers load it), and members of the form's own workspace looking
  // at their live form. Request details must be read before after();
  // analytics must never affect the page render, so everything after
  // that is best-effort.
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent");
  // Languages (P2.21) only on a plan that includes them.
  const offered = entitlements.multilingual
    ? formLanguages(compiled.schema)
    : [formLanguages(compiled.schema)[0]];
  const language = entitlements.multilingual
    ? pickLanguage(compiled.schema, query.lang, requestHeaders.get("accept-language"))
    : offered[0];
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
      {entitlements.tracking_pixels && <TrackingScripts ids={publicForm.tracking} />}
      <PublicFormRuntime
        formId={publicForm.formId}
        formVersionId={publicForm.formVersionId}
        compiled={compiled}
        savesProgress={publicForm.savePartialResponses}
        resumeLinks={publicForm.resumeLinksEnabled && publicForm.savePartialResponses}
        resume={resume}
        brandingRemovable={entitlements.remove_branding}
        languages={offered.map((code) => ({ code, name: LANGUAGES[code] }))}
        initialLanguage={language}
        schedulingAllowed={entitlements.scheduling}
        embedded={embedded}
        experimentId={experimentId}
        known={known}
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
