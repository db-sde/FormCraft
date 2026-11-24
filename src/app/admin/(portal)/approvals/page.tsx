import type { Metadata } from "next";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { RequestList, type ChangeRequest } from "./request-list";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const { staff } = await requireStaff("approvals.decide");
  const [pending, approved] = await Promise.all([
    adminCall<{ requests: ChangeRequest[] }>("admin_list_change_requests", {
      p_status: "pending",
    }),
    adminCall<{ requests: ChangeRequest[] }>("admin_list_change_requests", {
      p_status: "approved",
    }),
  ]);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold">Approvals</h1>
      <p className="text-muted-foreground text-sm">
        High-risk changes need a second person. Approving asks for a fresh authenticator
        code. Requests expire after 24 hours.
      </p>
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Waiting for a decision</h2>
        <RequestList
          requests={pending.ok ? pending.requests : []}
          mode="pending"
          isOwner={staff.role === "owner"}
        />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Approved, ready to apply</h2>
        <RequestList
          requests={approved.ok ? approved.requests : []}
          mode="approved"
          isOwner={staff.role === "owner"}
          canApply={staff.permissions.includes("staff.manage")}
        />
      </section>
    </main>
  );
}
