import type { Metadata } from "next";
import Link from "next/link";
import { AtSign, ExternalLink, Mail, MessageCircle, Rocket, Share2 } from "lucide-react";
import {
  getDraftForEdit,
  getFormSettings,
  getPublishedSchema,
  hasLeadCapture,
} from "@/domains/forms";
import { leadCaptureStatus } from "@/domains/leads";
import { FormSectionHeader } from "@/components/forms/form-top-bar";
import { CopyLinkField } from "@/components/forms/copy-link-field";
import { ShareEmbed, ShareQr } from "@/components/forms/share-popover";
import { PublishButton } from "@/components/forms/publish-button";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { loadFormForPage } from "../../load-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { form } = await loadFormForPage(id);
  return { title: `${form.title} · Share` };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: formId } = await params;
  const { supabase, workspace, form, isLive, hasUnpublishedChanges, publishState } =
    await loadFormForPage(formId);
  const [draft, published, settings] = await Promise.all([
    getDraftForEdit(supabase, formId, workspace.id),
    getPublishedSchema(supabase, formId),
    getFormSettings(supabase, formId, workspace.id),
  ]);
  const leadCapture = leadCaptureStatus({
    draftHasContactStep: hasLeadCapture(draft?.schema.questions ?? []),
    publishedHasContactStep: hasLeadCapture(published?.questions ?? []),
    isLive,
    savesUnfinished: settings?.savePartialResponses ?? true,
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const url = `${appUrl}/f/${form.slug}`;
  const shareText = encodeURIComponent(`${form.title} — ${url}`);

  return (
    <div className="flex flex-col gap-6">
      <FormSectionHeader
        formId={formId}
        title={form.title}
        active="share"
        state={publishState}
        hasChanges={hasUnpublishedChanges}
        crumbs={[{ label: "Share" }]}
      />

      {!isLive ? (
        <EmptyState
          icon={Rocket}
          tint="var(--chip-draft-bg)"
          title="Publish to get your link"
          description="Your form is still a draft, so nobody can open it yet. Publishing creates a public link. You can keep editing afterwards and publish changes whenever you're ready."
          actions={
            <>
              <PublishButton formId={formId} size="lg" />
              <Button asChild variant="outline" size="lg">
                <Link href={`/forms/${formId}`}>Keep editing</Link>
              </Button>
            </>
          }
        />
      ) : (
        <div className="flex flex-col gap-[26px]">
          {hasUnpublishedChanges && (
            <div className="flex flex-col gap-3 rounded-sm border-[1.5px] border-[var(--alert-warning-border)] bg-[var(--alert-warning-bg)] px-4 py-3 text-sm text-[var(--alert-warning-fg)] sm:flex-row sm:items-center sm:justify-between">
              <p>
                <b>Unpublished changes.</b> Respondents still see the last published
                version until you publish them.
              </p>
              <PublishButton formId={formId} label="Publish changes" />
            </div>
          )}

          <SettingsSection
            title="Link"
            description="Send it anywhere: email, chat, social posts or your bio. Anyone with the link can respond, no account needed."
            wide
          >
            <div className="flex flex-col gap-3">
              <CopyLinkField slug={form.slug} />
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={`/f/${form.slug}`} target="_blank" rel="noreferrer">
                    <ExternalLink /> Open live form
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`mailto:?subject=${encodeURIComponent(form.title)}&body=${encodeURIComponent(url)}`}
                  >
                    <Mail /> Email
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`https://wa.me/?text=${shareText}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle /> WhatsApp
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Share2 /> LinkedIn
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`https://twitter.com/intent/tweet?text=${shareText}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <AtSign /> X
                  </a>
                </Button>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            title="QR code"
            description="For posters, slides or a table tent. It opens the live form."
            wide
          >
            <ShareQr slug={form.slug} />
          </SettingsSection>

          <SettingsSection
            title="Embed on your website"
            description="Paste this where you want the form to appear. The standard embed resizes to fit each question, and embedded visits are counted separately."
            wide
          >
            <div className="flex flex-col gap-3.5">
              <ShareEmbed slug={form.slug} formId={form.id} title={form.title} />
            </div>
          </SettingsSection>
        </div>
      )}

      <SettingsSection
        title={leadCapture.title}
        description={leadCapture.description}
        last
      >
        {leadCapture.state === "off" ? (
          <Button asChild size="sm">
            <Link href={`/forms/${formId}?leadCapture=1`}>Add lead capture</Link>
          </Button>
        ) : leadCapture.state === "paused" ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/forms/${formId}/settings`}>Open settings</Link>
          </Button>
        ) : leadCapture.state === "needs_publish" ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/forms/${formId}`}>Open in builder</Link>
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={`/leads?form=${formId}`}>View leads</Link>
          </Button>
        )}
      </SettingsSection>
    </div>
  );
}
