import Link from "next/link";
import { FilePlus2, LayoutTemplate } from "lucide-react";
import { listFormsForWorkspace } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createFormAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function DashboardPage() {
  const { supabase, workspace } = await getCurrentWorkspace();
  const forms = await listFormsForWorkspace(supabase, workspace.id);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Forms</h1>
          <p className="text-muted-foreground text-sm">
            {forms.length === 0
              ? "Create your first form to start collecting responses."
              : `${forms.length} form${forms.length === 1 ? "" : "s"} in ${workspace.name}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/templates">
              <LayoutTemplate />
              Browse templates
            </Link>
          </Button>
          <form action={createFormAction}>
            <Button type="submit">
              <FilePlus2 />
              New form
            </Button>
          </form>
        </div>
      </div>

      {forms.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <FilePlus2 className="text-muted-foreground size-8" />
            <p className="font-medium">No forms yet</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Forms you create will show up here. Start from scratch or pick a template.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <form action={createFormAction}>
                <Button type="submit">Start from scratch</Button>
              </form>
              <Button asChild variant="outline">
                <Link href="/templates">Browse templates</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((form) => (
            <Link key={form.id} href={`/forms/${form.id}`}>
              <Card className="hover:border-foreground/30 h-full transition-colors">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{form.title}</CardTitle>
                    <Badge variant={form.hasPublishedVersion ? "default" : "secondary"}>
                      {form.hasPublishedVersion ? "Published" : "Draft"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-muted-foreground text-sm">
                  {form.responseCount} response{form.responseCount === 1 ? "" : "s"} ·
                  Updated {new Date(form.updatedAt).toLocaleDateString()}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
