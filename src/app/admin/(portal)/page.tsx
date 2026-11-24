import Link from "next/link";
import { adminCall, requireStaff } from "@/lib/admin/staff";

export default async function StaffHome() {
  const { staff } = await requireStaff();
  const pending = staff.permissions.includes("approvals.decide")
    ? await adminCall<{ requests: unknown[] }>("admin_list_change_requests", {
        p_status: "pending",
      })
    : null;
  return (
    <main className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">Hello, {staff.displayName}</h1>
      {pending?.ok && pending.requests.length > 0 && (
        <p className="border-warning bg-accent rounded-sm border-[1.5px] px-3 py-2 text-sm">
          {pending.requests.length} change{pending.requests.length === 1 ? "" : "s"}{" "}
          waiting for approval.{" "}
          <Link href="/admin/approvals" className="font-semibold underline">
            Review
          </Link>
        </p>
      )}
      <section className="border-border rounded-lg border-[1.5px] p-4">
        <h2 className="mb-2 font-semibold">What your role can do</h2>
        <ul className="text-muted-foreground grid gap-1 text-sm sm:grid-cols-2">
          {staff.permissions.map((p) => (
            <li key={p}>
              <code>{p}</code>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-muted-foreground text-sm">
        Everything you do here is recorded in the audit trail, including what you look at.
        Customers, billing, usage, AI and privacy screens arrive in the next phases.
      </p>
    </main>
  );
}
