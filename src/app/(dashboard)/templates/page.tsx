import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LayoutTemplate, Plus } from "lucide-react";
import { listTemplates } from "@/domains/templates";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createFormAction, createFormFromTemplateAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FormPreviewArt } from "@/components/forms/form-preview-art";
import { GenerateFormCard } from "@/components/dashboard/generate-form-card";
import { aiConfigured } from "@/domains/ai/config";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const { supabase } = await getCurrentWorkspace();
  const templates = await listTemplates(supabase);
  const categories = [...new Set(templates.map((tpl) => tpl.category))];

  return (
    <div className="flex flex-col gap-[22px]">
      <Link
        href="/dashboard"
        className="fc-focus text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 rounded-xs text-sm font-semibold"
      >
        <ArrowLeft className="size-4" />
        Back to forms
      </Link>
      <div>
        <h1 className="font-heading text-[38px] leading-none font-bold tracking-[-0.03em] sm:text-[56px] sm:tracking-[-0.035em]">
          Choose a template
        </h1>
        <p className="text-muted-foreground mt-2.5 text-[15px]">
          Start from something that works, then make it yours.
        </p>
      </div>

      <form action={createFormAction}>
        <button
          type="submit"
          className="fc-focus group border-ink bg-card hover:bg-accent flex w-full items-center gap-[18px] rounded-lg border-[1.5px] border-dashed px-5 py-4 text-left"
        >
          <span className="border-ink bg-primary shadow-raised grid size-11 shrink-0 place-items-center rounded-sm border-[1.5px] text-[#2b2118]">
            <Plus className="size-5" />
          </span>
          <span className="flex flex-col gap-[3px]">
            <span className="font-heading text-lg leading-[1.2] font-bold">
              Start from scratch
            </span>
            <span className="text-muted-foreground text-sm">
              A short contact form to reshape: a welcome, a question and contact details.
            </span>
          </span>
        </button>
      </form>

      <GenerateFormCard enabled={aiConfigured()} />

      {templates.length === 0 && (
        <EmptyState
          icon={LayoutTemplate}
          tint="var(--qt-other-bg)"
          title="No templates here yet"
          description="We're still stocking the shelves. A blank form is just as quick."
          className="py-10"
        />
      )}

      {categories.map((category) => {
        const items = templates.filter((tpl) => tpl.category === category);
        return (
          <section key={category} className="mt-3 flex flex-col gap-3.5">
            <div className="flex items-baseline gap-2.5">
              <h2 className="font-heading text-[26px] leading-[1.1] font-bold tracking-[-0.02em]">
                {category}
              </h2>
              <span className="text-muted-foreground text-[13px]">
                {items.length} template{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="wide:grid-cols-4 grid gap-[22px] sm:grid-cols-2 lg:grid-cols-3">
              {items.map((template) => (
                <div
                  key={template.id}
                  className="border-ink bg-card flex flex-col overflow-hidden rounded-lg border-[1.5px]"
                >
                  <FormPreviewArt
                    preview={template.preview}
                    progress={false}
                    className="border-ink h-[136px] border-b-[1.5px]"
                  />
                  <div className="flex flex-1 flex-col gap-1.5 p-[18px]">
                    <h3 className="font-heading text-[17px] leading-[1.3] font-bold">
                      {template.title}
                    </h3>
                    <p className="text-muted-foreground flex-1 text-sm leading-[1.45] text-pretty">
                      {template.description}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[12.5px]">
                      {template.questionCount} question
                      {template.questionCount === 1 ? "" : "s"} · ~
                      {Math.max(1, Math.round(template.questionCount / 3))} min
                    </p>
                    <form
                      action={createFormFromTemplateAction.bind(null, template.id)}
                      className="mt-2.5"
                    >
                      <SubmitButton
                        variant="outline"
                        className="data-[loading=true]:bg-primary w-full font-semibold"
                        pendingLabel="Creating form…"
                      >
                        Use this template
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
