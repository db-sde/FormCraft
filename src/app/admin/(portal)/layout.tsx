import Link from "next/link";
import { requireStaff, type StaffPermission } from "@/lib/admin/staff";
import { Button } from "@/components/ui/button";
import { staffSignOutAction } from "../actions";

const NAV: { href: string; label: string; permission: StaffPermission }[] = [
  { href: "/admin", label: "Home", permission: "portal.access" },
  { href: "/admin/customers", label: "Customers", permission: "customers.read" },
  { href: "/admin/plans", label: "Plans", permission: "plans.read" },
  { href: "/admin/approvals", label: "Approvals", permission: "approvals.decide" },
  { href: "/admin/staff", label: "Staff", permission: "staff.manage" },
  { href: "/admin/audit", label: "Audit trail", permission: "audit.read" },
];

/** Every portal page: signed in as active staff, with a second factor. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { staff } = await requireStaff();
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-6">
      <header className="border-ink flex flex-wrap items-center gap-4 border-b-[1.5px] pb-4">
        <b className="font-heading text-lg">FormCraft staff</b>
        <nav aria-label="Staff" className="flex flex-wrap gap-1">
          {NAV.filter((n) => staff.permissions.includes(n.permission)).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="fc-focus hover:bg-hover-wash rounded-sm px-2.5 py-1.5 text-sm font-semibold"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="text-muted-foreground ml-auto text-sm">
          {staff.displayName} · {staff.role.replace("_", " ")}
        </span>
        <form action={staffSignOutAction}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      {children}
    </div>
  );
}
