import Link from "next/link";
import { cn } from "cn";

export type FormTab = "build" | "share" | "responses" | "integrations" | "settings";

/** The form's sections as a segmented control (Parts 4 and 5). Share
 * isn't a tab — it's the header's Share popover, which links to the
 * full Share page. */
const TABS: { id: FormTab; label: string; href: (formId: string) => string }[] = [
  { id: "build", label: "Build", href: (id) => `/forms/${id}` },
  { id: "responses", label: "Responses", href: (id) => `/forms/${id}/responses` },
  {
    id: "integrations",
    label: "Integrations",
    href: (id) => `/forms/${id}/integrations`,
  },
  { id: "settings", label: "Settings", href: (id) => `/forms/${id}/settings` },
];

export function FormTabs({
  formId,
  active,
  className,
  viewOnly = false,
}: {
  formId: string;
  active: FormTab;
  className?: string;
  /** Viewers see only what they can use. */
  viewOnly?: boolean;
}) {
  return (
    <nav
      aria-label="Form sections"
      className={cn(
        "border-ink bg-background flex gap-0.5 rounded-[8px] border-[1.5px] p-[3px] text-sm font-semibold",
        className,
      )}
    >
      {TABS.filter((tab) => !viewOnly || tab.id === "responses").map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href(formId)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "fc-focus shrink-0 rounded-[5px] px-3.5 py-[7px] whitespace-nowrap max-xl:px-2.5",
              isActive
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-hover-wash hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
