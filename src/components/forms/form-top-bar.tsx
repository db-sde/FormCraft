import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { PublishState } from "@/domains/forms";
import { FormStatusBadge } from "./form-status-badge";
import { FormTabs, type FormTab } from "./form-tabs";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";

/**
 * The top of a form's Responses / Integrations / Settings / Share pages
 * (Part 5): breadcrumb, the form's name, its publish state and the
 * section tabs, over an ink rule.
 */
export async function FormSectionHeader({
  formId,
  title,
  active,
  state,
  hasChanges = false,
  crumbs = [],
  actions,
}: {
  formId: string;
  title: string;
  active: FormTab;
  state: PublishState;
  hasChanges?: boolean;
  /** Extra breadcrumb steps after the form, e.g. a response. */
  crumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode;
}) {
  const trail = [{ label: title, href: `/forms/${formId}/responses` }, ...crumbs];
  const { workspace } = await getCurrentWorkspace();
  const viewOnly = !canEdit(workspace.role);
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          Forms
        </Link>
        {trail.map((step, i) => {
          const last = i === trail.length - 1;
          return (
            <span key={i} className="flex min-w-0 items-center gap-2">
              <ChevronRight
                aria-hidden
                className="text-subtle-foreground size-3.5 shrink-0"
              />
              {last || !step.href ? (
                <b aria-current={last ? "page" : undefined} className="truncate">
                  {step.label}
                </b>
              ) : (
                <Link
                  href={step.href}
                  className="text-muted-foreground hover:text-foreground truncate"
                >
                  {step.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
      <div className="border-ink flex flex-col gap-4 border-b-[1.5px] pb-3.5 lg:flex-row lg:items-end lg:justify-between lg:gap-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-heading min-w-0 text-[30px] leading-[1.05] font-bold tracking-[-0.03em] break-words sm:text-[44px] sm:leading-none">
            {title}
          </h1>
          <FormStatusBadge state={state} hasChanges={hasChanges} />
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {viewOnly ? (
            <span className="text-muted-foreground text-[13px] font-semibold">
              View only
            </span>
          ) : (
            actions
          )}
          <FormTabs
            formId={formId}
            active={active}
            viewOnly={viewOnly}
            className="max-w-full overflow-x-auto"
          />
        </div>
      </div>
    </div>
  );
}
