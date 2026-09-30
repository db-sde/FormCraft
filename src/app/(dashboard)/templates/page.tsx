import { FilePlus2, LayoutTemplate } from "lucide-react";
import { listTemplates } from "@/domains/templates";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createFormAction, createFormFromTemplateAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export default async function TemplatesPage() {
  const { supabase } = await getCurrentWorkspace();
  const templates = await listTemplates(supabase);

  const categories = [...new Set(templates.map((tpl) => tpl.category))];

  return (
    <>
      <PageHeader
        title="Templates"
        description="Start from a ready-made form and make it yours — every template is fully editable."
        actions={
          <form action={createFormAction}>
            <SubmitButton variant="outline" icon={<FilePlus2 />} pendingLabel="Creating…">
              Start from scratch
            </SubmitButton>
          </form>
        }
      />

      {templates.length === 0 && (
        <EmptyState
          icon={LayoutTemplate}
          title="No templates available"
          description="Start from scratch instead — a new form comes with a starter set of questions, including lead capture."
        />
      )}

      {categories.map((category) => (
        <section key={category} className="mb-10">
          <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
            {category}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates
              .filter((tpl) => tpl.category === category)
              .map((template) => (
                <div
                  key={template.id}
                  className="bg-card hover:border-primary/40 flex flex-col rounded-xl border p-5 shadow-xs transition-colors"
                >
                  <span className="bg-accent text-accent-foreground grid size-9 place-items-center rounded-lg">
                    <LayoutTemplate className="size-4" />
                  </span>
                  <h3 className="mt-3 font-medium">{template.title}</h3>
                  <p className="text-muted-foreground mt-1 flex-1 text-sm">
                    {template.description}
                  </p>
                  <form
                    action={createFormFromTemplateAction.bind(null, template.id)}
                    className="mt-4"
                  >
                    <SubmitButton
                      className="w-full"
                      variant="secondary"
                      pendingLabel="Creating form…"
                    >
                      Use this template
                    </SubmitButton>
                  </form>
                </div>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}
