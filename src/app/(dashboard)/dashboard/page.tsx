import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  FileText,
  Hammer,
  Hourglass,
  Inbox,
  LayoutTemplate,
  Plus,
  Send,
  UsersRound,
} from "lucide-react";
import { listFormsForWorkspace } from "@/domains/forms";
import { countLeads } from "@/domains/leads";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createFormAction } from "../actions";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/app-shell/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { FormRow } from "@/components/dashboard/form-row";
import { cn } from "cn";

const HOW_IT_WORKS = [
  {
    icon: Hammer,
    title: "Build",
    text: "Add questions one screen at a time, theme it, and branch with logic.",
  },
  {
    icon: Send,
    title: "Publish & share",
    text: "Get a link to send anywhere, or embed the form on your website.",
  },
  {
    icon: UsersRound,
    title: "Collect leads & responses",
    text: "Contact details are saved even when people don't finish.",
  },
];

function NewFormButton() {
  return (
    <form action={createFormAction}>
      <SubmitButton icon={<Plus />} pendingLabel="Creating…">
        New form
      </SubmitButton>
    </form>
  );
}

export default async function DashboardPage() {
  const { supabase, workspace } = await getCurrentWorkspace();
  const [forms, leadCount] = await Promise.all([
    listFormsForWorkspace(supabase, workspace.id),
    countLeads(supabase, workspace.id),
  ]);

  if (forms.length === 0) {
    return (
      <>
        <PageHeader
          title="Welcome to FormCraft"
          description="Create forms people enjoy filling out — and never lose a lead, even when they don't finish."
        />
        <div className="bg-card rounded-2xl border p-6 shadow-xs sm:p-10">
          <div className="grid gap-6 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.title}>
                <span className="bg-accent text-accent-foreground grid size-10 place-items-center rounded-lg">
                  <step.icon className="size-5" />
                </span>
                <p className="mt-3 font-medium">
                  {i + 1}. {step.title}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">{step.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-2 border-t pt-6">
            <form action={createFormAction}>
              <SubmitButton size="lg" icon={<Plus />} pendingLabel="Creating…">
                Start from scratch
              </SubmitButton>
            </form>
            <Button asChild size="lg" variant="outline">
              <Link href="/templates">
                <LayoutTemplate />
                Browse templates
              </Link>
            </Button>
          </div>
        </div>
      </>
    );
  }

  const liveForms = forms.filter((f) => f.hasPublishedVersion);
  const completed = forms.reduce((sum, f) => sum + f.responseCount, 0);
  const incomplete = forms.reduce((sum, f) => sum + f.incompleteCount, 0);

  // Next step for someone still getting set up.
  const firstDraft = forms.find((f) => !f.hasPublishedVersion) ?? forms[0];
  const firstLive = liveForms[0];
  const checklist = [
    { done: true, label: "Create a form", href: `/forms/${forms[0].id}` },
    {
      done: liveForms.length > 0,
      label: "Publish it to get a shareable link",
      href: `/forms/${firstDraft.id}/share`,
    },
    {
      done: completed + incomplete > 0,
      label: "Share the link and get your first response",
      href: `/forms/${(firstLive ?? firstDraft).id}/share`,
    },
    {
      done: leadCount > 0,
      label: "Capture your first lead",
      href: `/forms/${(firstLive ?? firstDraft).id}/share`,
    },
  ];
  const doneCount = checklist.filter((s) => s.done).length;

  return (
    <>
      <PageHeader
        title="Forms"
        description="Build, share, and follow up on every response."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/templates">
                <LayoutTemplate />
                Templates
              </Link>
            </Button>
            <NewFormButton />
          </>
        }
      />

      {doneCount < checklist.length && (
        <div className="bg-card mb-6 rounded-xl border p-5 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">Get started</p>
            <span className="text-muted-foreground text-xs">
              {doneCount} of {checklist.length} done
            </span>
          </div>
          <div className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${(doneCount / checklist.length) * 100}%` }}
            />
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2">
            {checklist.map((step) => (
              <li key={step.label}>
                <Link
                  href={step.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md p-2 text-sm",
                    step.done
                      ? "text-muted-foreground line-through"
                      : "hover:bg-muted font-medium",
                  )}
                >
                  {step.done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="text-muted-foreground size-4 shrink-0" />
                  )}
                  {step.label}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Live forms"
          value={liveForms.length}
          hint={`of ${forms.length} total`}
          icon={FileText}
        />
        <StatCard
          label="Completed responses"
          value={completed}
          hint="Submitted forms"
          icon={Inbox}
        />
        <StatCard
          label="Incomplete"
          value={incomplete}
          hint="Answered some, didn't submit"
          icon={Hourglass}
        />
        <StatCard
          label="Leads"
          value={leadCount}
          hint="View all contacts →"
          icon={UsersRound}
          href="/leads"
        />
      </div>

      <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
        <div className="text-muted-foreground flex items-center justify-between border-b px-4 py-2.5 text-xs font-medium">
          <span>
            {forms.length} form{forms.length === 1 ? "" : "s"}
          </span>
          <span className="hidden pr-12 sm:block">Responses</span>
        </div>
        <div className="divide-y">
          {forms.map((form) => (
            <FormRow key={form.id} form={form} />
          ))}
        </div>
      </div>
    </>
  );
}
