import type { Metadata } from "next";
import Link from "next/link";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { LocalTime } from "@/components/local-time";
import { AccessReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Access review" };

type Review = {
  now: string;
  due_at: string | null;
  last_review: {
    reviewed_at: string;
    reviewer: string | null;
    notes: string | null;
  } | null;
  staff: {
    user_id: string;
    display_name: string;
    email: string;
    role: string;
    status: string;
    added_at: string;
    last_seen_at: string | null;
    actions_30d: number;
    denied_30d: number;
    addresses: number;
    removed_permissions: string[];
  }[];
};

/** The owner's monthly look at who has staff access, and why. */
export default async function AccessReviewPage() {
  await requireStaff("staff.manage");
  const review = await adminCall<Review>("admin_access_review");
  if (!review.ok) return <p>Couldn&apos;t load the review.</p>;
  const now = Date.parse(review.now);
  const due = review.due_at ? Date.parse(review.due_at) : null;
  const active = review.staff.filter((s) => s.status === "active");

  return (
    <main className="flex flex-col gap-5">
      <Link href="/admin/staff" className="text-sm underline">
        ← Staff
      </Link>
      <h1 className="font-heading text-2xl font-bold">Access review</h1>
      <p className="text-sm">
        {review.last_review ? (
          <>
            Last reviewed <LocalTime iso={review.last_review.reviewed_at} variant="day" />{" "}
            by {review.last_review.reviewer ?? "—"}.{" "}
          </>
        ) : (
          "Not reviewed yet. "
        )}
        {due !== null &&
          (due < now ? (
            <b className="text-destructive">A review is due now.</b>
          ) : (
            <>
              Next one due <LocalTime iso={review.due_at!} variant="day" />.
            </>
          ))}
      </p>

      <div className="border-border overflow-x-auto rounded-lg border-[1.5px]">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Last seen</th>
              <th className="px-3 py-2">Actions (30 d)</th>
              <th className="px-3 py-2">Refused (30 d)</th>
              <th className="px-3 py-2">Addresses</th>
              <th className="px-3 py-2">Worth a look</th>
            </tr>
          </thead>
          <tbody>
            {review.staff.map((s) => {
              const seen = s.last_seen_at ? Date.parse(s.last_seen_at) : null;
              const flags = [
                s.status === "active" && (seen === null || now - seen > 30 * 86_400_000)
                  ? "not seen for 30 days"
                  : null,
                s.denied_30d > 20 ? "many refusals" : null,
                s.role === "owner" ? "owner" : null,
              ].filter(Boolean);
              return (
                <tr key={s.user_id} className="border-border border-t">
                  <td className="px-3 py-2">
                    {s.display_name}
                    <div className="text-muted-foreground text-xs">{s.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    {s.role.replace("_", " ")}
                    {s.removed_permissions.length > 0 && (
                      <div className="text-muted-foreground text-xs">
                        without {s.removed_permissions.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{s.status}</td>
                  <td className="px-3 py-2">
                    {s.last_seen_at ? (
                      <LocalTime iso={s.last_seen_at} variant="day" />
                    ) : (
                      "Never"
                    )}
                  </td>
                  <td className="px-3 py-2">{s.actions_30d}</td>
                  <td className="px-3 py-2">{s.denied_30d}</td>
                  <td className="px-3 py-2">{s.addresses}</td>
                  <td className="px-3 py-2">{flags.join(", ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AccessReviewForm people={active} />
    </main>
  );
}
