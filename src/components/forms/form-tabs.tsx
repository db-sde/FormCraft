import Link from "next/link";
import { Hammer, Inbox, Plug, Send, Settings } from "lucide-react";
import { cn } from "cn";

export type FormTab = "build" | "share" | "responses" | "integrations" | "settings";

const TABS: {
  id: FormTab;
  label: string;
  icon: typeof Hammer;
  href: (formId: string) => string;
}[] = [
  { id: "build", label: "Build", icon: Hammer, href: (id) => `/forms/${id}` },
  { id: "share", label: "Share", icon: Send, href: (id) => `/forms/${id}/share` },
  {
    id: "responses",
    label: "Responses",
    icon: Inbox,
    href: (id) => `/forms/${id}/responses`,
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: Plug,
    href: (id) => `/forms/${id}/integrations`,
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    href: (id) => `/forms/${id}/settings`,
  },
];

/** Everything you do with a form, in the order you do it — identical
 * on every form page. */
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
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href(formId)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
