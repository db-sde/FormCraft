import Link from "next/link";
import {
  AlertTriangle,
  Code2,
  Contact,
  Globe,
  Share2,
  Mail,
  MessageCircle,
  Rocket,
  AtSign,
} from "lucide-react";
import {
  buildEmbedSnippet,
  getDraftForEdit,
  getFormSettings,
  getPublishedSchema,
  hasLeadCapture,
} from "@/domains/forms";
import { leadCaptureStatus } from "@/domains/leads";
import { FormTopBar, FormTitle } from "@/components/forms/form-top-bar";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import {
  CopyLinkButton,
  CopyTextButton,
  OpenLiveButton,
} from "@/components/forms/live-link-actions";
import { PublishButton } from "@/components/forms/publish-button";
import { Button } from "@/components/ui/button";
import { loadFormForPage } from "../load-form";

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border p-5 shadow-xs sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="bg-accent text-accent-foreground grid size-9 shrink-0 place-items-center rounded-lg">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
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
  const embed = buildEmbedSnippet({ formUrl: url, formId: form.id, title: form.title });

  return (
    <>
      <FormTopBar
        formId={formId}
        active="share"
        title={
          <>
            <FormTitle>{form.title}</FormTitle>
            <FormStatusBadge state={publishState} />
          </>
        }
      />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Share your form</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Anyone with the link can respond — no account needed.
          </p>
        </div>

        {!isLive ? (
          <section className="bg-card flex flex-col items-center gap-3 rounded-xl border p-10 text-center shadow-xs">
            <span className="bg-accent text-accent-foreground grid size-12 place-items-center rounded-full">
              <Rocket className="size-5" />
            </span>
            <h2 className="text-lg font-semibold">Publish to get your link</h2>
            <p className="text-muted-foreground max-w-md text-sm">
              Your form is still a draft, so nobody can open it yet. Publishing creates a
              public link. You can keep editing afterwards and publish changes whenever
              you&apos;re ready.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <PublishButton formId={formId} size="lg" />
              <Button asChild variant="outline" size="lg">
                <Link href={`/forms/${formId}`}>Keep editing</Link>
              </Button>
            </div>
          </section>
        ) : (
          <>
            {hasUnpublishedChanges && (
              <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  You&apos;ve edited this form since it was published. Respondents still
                  see the previous version until you publish the changes.
                </p>
                <PublishButton formId={formId} label="Publish changes" />
              </div>
            )}

            <Section
              icon={Globe}
              title="Link"
              description="Send it anywhere — email, chat, social posts, or your bio."
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="bg-muted/60 flex min-w-0 flex-1 items-center rounded-md border px-3 py-2 font-mono text-sm">
                  <span className="truncate">{url}</span>
                </div>
                <div className="flex gap-2">
                  <CopyLinkButton slug={form.slug} label="Copy link" variant="default" />
                  <OpenLiveButton slug={form.slug} label="Open" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
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
            </Section>

            <Section
              icon={Code2}
              title="Embed on your website"
              description="Paste this where you want the form to appear on your site. It resizes to fit each question, and embedded visits are tracked separately."
            >
              <pre className="bg-muted/60 overflow-x-auto rounded-md border p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                {embed}
              </pre>
              <div className="mt-3">
                <CopyTextButton text={embed} label="Copy embed code" />
              </div>
            </Section>
          </>
        )}

        <Section
          icon={Contact}
          title={leadCapture.title}
          description={leadCapture.description}
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
        </Section>
      </main>
    </>
  );
}
