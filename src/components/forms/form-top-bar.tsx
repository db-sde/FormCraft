import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FormTabs, type FormTab } from "./form-tabs";

/**
 * The header of every page inside a form: back to all forms, the form's
 * name, the Build · Share · Responses · Integrations tabs, and
 * page-specific actions on the right. Tabs sit centred on wide screens
 * and move to their own scrollable row on narrow ones.
 */
export function FormTopBar({
  formId,
  active,
  title,
  actions,
}: {
  formId: string;
  active: FormTab;
  /** Title area — plain text, or the builder's editable title + save state. */
  title: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="bg-background sticky top-0 z-30 border-b">
      <div className="flex h-14 items-center gap-2 px-2 sm:px-3 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon" aria-label="All forms">
                <Link href="/dashboard">
                  <ArrowLeft />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>All forms</TooltipContent>
          </Tooltip>
          <div className="flex min-w-0 items-center gap-2">{title}</div>
        </div>
        <FormTabs formId={formId} active={active} className="hidden lg:flex" />
        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5">
          {actions}
        </div>
      </div>
      <FormTabs
        formId={formId}
        active={active}
        className="overflow-x-auto border-t px-2 py-1.5 lg:hidden"
      />
    </header>
  );
}

/** Plain title for form pages other than the builder. */
export function FormTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="truncate text-sm font-semibold sm:text-base">{children}</h1>;
}
