"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const LINKS = [
  // A form's own pages live under /forms/*, so "Forms" stays active there.
  { href: "/dashboard", label: "Forms", match: ["/dashboard", "/forms"] },
  { href: "/templates", label: "Templates", match: ["/templates"] },
];

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active = link.match.some(
          (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
        );
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
