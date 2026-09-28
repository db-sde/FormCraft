import Link from "next/link";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { listTemplates } from "@/domains/templates";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createFormAction, createFormFromTemplateAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default async function TemplatesPage() {
  const { supabase } = await getCurrentWorkspace();
  const templates = await listTemplates(supabase);

  const categories = [...new Set(templates.map((tpl) => tpl.category))];

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-3.5" />
            Back to forms
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Choose a template</h1>
          <p className="text-muted-foreground text-sm">
            Start from a ready-made form, or begin with a blank one.
          </p>
        </div>
        <form action={createFormAction}>
          <Button type="submit" variant="outline">
            <FilePlus2 />
            Start from scratch
          </Button>
        </form>
      </div>

      {categories.map((category) => (
        <section key={category} className="mb-10">
          <h2 className="mb-3 text-sm font-medium tracking-wide uppercase">
            {category}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates
              .filter((tpl) => tpl.category === category)
              .map((template) => (
                <Card key={template.id} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-base">{template.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-muted-foreground flex-1 text-sm">
                    {template.description}
                  </CardContent>
                  <CardFooter>
                    <form
                      action={createFormFromTemplateAction.bind(null, template.id)}
                      className="w-full"
                    >
                      <Button type="submit" className="w-full" variant="secondary">
                        Use this template
                      </Button>
                    </form>
                  </CardFooter>
                </Card>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
