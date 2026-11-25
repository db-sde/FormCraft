import type { Metadata } from "next";
import Link from "next/link";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { LocalTime } from "@/components/local-time";
import { StaffChangeForm } from "./staff-change-form";

export const metadata: Metadata = { title: "Staff" };

type Member = {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  created_at: string;
  second_factor: boolean;
};

export default async function StaffPage() {
  await requireStaff("staff.manage");
  const list = await adminCall<{ staff: Member[] }>("admin_list_staff");
  const staff = list.ok ? list.staff : [];
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-heading text-2xl font-bold">Staff</h1>
        <Link href="/admin/staff/review" className="text-sm underline">
          Access review
        </Link>
      </div>
      <div className="border-border overflow-x-auto rounded-lg border-[1.5px]">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Authenticator</th>
              <th className="px-3 py-2">Since</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((m) => (
              <tr key={m.user_id} className="border-border border-t">
                <td className="px-3 py-2">{m.display_name}</td>
                <td className="px-3 py-2">{m.email}</td>
                <td className="px-3 py-2">{m.role.replace("_", " ")}</td>
                <td className="px-3 py-2">{m.status}</td>
                <td className="px-3 py-2">{m.second_factor ? "Set up" : "Not yet"}</td>
                <td className="px-3 py-2">
                  <LocalTime iso={m.created_at} variant="date" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Ask for a change</h2>
        <p className="text-muted-foreground text-sm">
          Adding someone, changing a role or disabling an account needs a second
          person&apos;s approval. New staff sign up with a staff-only email first.
        </p>
        <StaffChangeForm />
      </section>
    </main>
  );
}
