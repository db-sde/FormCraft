import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { listFormsForWorkspace } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createFormAction } from "../actions";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { FormsBrowser } from "@/components/dashboard/forms-browser";
import { OnboardingDialog } from "@/components/dashboard/onboarding-dialog";

export const metadata: Metadata = { title: "Forms" };

export default async function DashboardPage() {
  const { supabase, workspace, user } = await getCurrentWorkspace();
  const forms = await listFormsForWorkspace(supabase, workspace.id);

  if (forms.length === 0) {
    const fullName = (user.user_metadata?.full_name as string | undefined) ?? "";
    return (
      <div className="flex min-h-[calc(100dvh-5rem)] flex-col gap-[22px]">
        <div>
          <div className="text-muted-foreground text-[13px] sm:text-[15px]">
            0 forms in {workspace.name}
          </div>
          <h1 className="font-heading mt-2 text-[38px] leading-none font-bold tracking-[-0.03em] sm:text-[56px] sm:tracking-[-0.035em]">
            Forms
          </h1>
        </div>
        <div className="border-ink bg-card grid flex-1 place-items-center rounded-xl border-[1.5px] border-dashed px-6 py-14">
          <div className="flex max-w-[440px] flex-col items-center gap-3.5 text-center">
            <div aria-hidden className="relative mb-1.5 h-[110px] w-[150px]">
              <div className="border-ink absolute top-3 left-2.5 h-20 w-24 -rotate-10 rounded-lg border-[1.5px] bg-[var(--qt-text-bg)]" />
              <div className="border-ink bg-primary shadow-card absolute top-1 left-11 grid h-20 w-24 rotate-6 place-items-center rounded-lg border-[1.5px]">
                <Plus className="size-[30px] text-[#2b2118]" />
              </div>
            </div>
            <h2 className="font-heading text-[30px] leading-[1.1] font-bold tracking-[-0.02em]">
              No forms yet
            </h2>
            <p className="text-muted-foreground text-[15.5px] leading-[1.55] text-pretty">
              Your first one takes about two minutes. Start with a blank form, or borrow
              one of our templates and make it yours.
            </p>
            <div className="mt-1.5 flex flex-wrap justify-center gap-3">
              <form action={createFormAction}>
                <SubmitButton
                  size="auth"
                  className="shadow-card px-5 text-[15px]"
                  icon={<Plus />}
                  pendingLabel="Creating…"
                >
                  Start from scratch
                </SubmitButton>
              </form>
              <Button
                asChild
                size="auth"
                variant="outline"
                className="px-5 text-[15px] font-semibold"
              >
                <Link href="/templates">Browse templates</Link>
              </Button>
            </div>
          </div>
        </div>
        <OnboardingDialog firstName={fullName.trim().split(/\s+/)[0] ?? ""} />
      </div>
    );
  }

  return <FormsBrowser forms={forms} workspaceName={workspace.name} />;
}
