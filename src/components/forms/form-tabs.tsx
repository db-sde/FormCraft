import Link from "next/link";
import { cn } from "cn";

export type FormTab = "build" | "responses" | "integrations";

const TABS: { id: FormTab; label: string; href: (formId: string) => string }[] = [
  { id: "build", label: "Build", href: (id) => `/forms/${id}` },
  { id: "responses", label: "Responses", href: (id) => `/forms/${id}/responses` },
  {
    id: "integrations",
    label: "Integrations",
    href: (id) => `/forms/${id}/integrations`,
  },
];

/** The same three form-level destinations, in the same place, on every
 * form page — so moving between editing a form and seeing its results
 * never depends on which page you happen to be on. */
export function FormTabs({
  formId,
  active,
  className,
}: {
  formId: string;
  active: FormTab;
  className?: string;
}) {
  return (
    <nav aria-label="Form sections" className={cn("flex items-center gap-1", className)}>
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href(formId)}
          aria-current={tab.id === active ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            tab.id === active
              ? "bg-muted text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
