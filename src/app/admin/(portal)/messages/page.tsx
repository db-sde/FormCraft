import type { Metadata } from "next";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { DraftNoticeForm, NoticeActions } from "./notice-forms";

export const metadata: Metadata = { title: "Notices" };

type Notice = {
  id: string;
  kind: string;
  subject: string;
  body: string;
  audience: { type: string; plans?: string[]; ids?: string[] };
  recipients: number;
  status: "draft" | "sending" | "sent" | "cancelled";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_by_name: string | null;
  sent: number;
  failed: number;
  waiting: number;
  pending_request: string | null;
};

const KIND: Record<string, string> = {
  incident: "Incident",
  billing: "Billing",
  policy: "Policy",
  service: "Service",
};

function audienceText(a: Notice["audience"]) {
  if (a.type === "all") return "every workspace owner";
  if (a.type === "plans") return `owners on ${a.plans?.join(", ")}`;
  return `owners of ${a.ids?.length ?? 0} chosen workspace(s)`;
}

/** Service notices to customers (ADM-098): each needs someone else's
 * approval, at most five start a day, and every recipient is logged. */
export default async function NoticesPage() {
  await requireStaff("comms.send");
  const [list, plans] = await Promise.all([
    adminCall<{ messages: Notice[] }>("admin_message_list"),
    adminCall<{ plans: { id: string }[] }>("admin_list_plans"),
  ]);
  if (!list.ok) return <p>Couldn&apos;t load notices.</p>;
  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-heading text-2xl font-bold">Notices</h1>
      <DraftNoticeForm plans={plans.ok ? plans.plans.map((p) => p.id) : []} />
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Notices</h2>
        {list.messages.length === 0 && (
          <p className="text-muted-foreground text-sm">None yet.</p>
        )}
        {list.messages.map((m) => (
          <article
            key={m.id}
            className="border-border flex flex-col gap-2 rounded-lg border-[1.5px] p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                {KIND[m.kind] ?? m.kind}: {m.subject}
              </h3>
              <span className="text-muted-foreground text-sm">
                {m.status === "draft"
                  ? m.pending_request
                    ? "Waiting for approval"
                    : "Draft"
                  : m.status === "sending"
                    ? `Sending: ${m.sent} of ${m.recipients}`
                    : m.status === "sent"
                      ? `Sent to ${m.sent} of ${m.recipients}${m.failed ? `, ${m.failed} failed` : ""}`
                      : "Cancelled"}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              To {audienceText(m.audience)} ({m.recipients} now) · written by{" "}
              {m.created_by_name ?? "—"} on {m.created_at.slice(0, 10)}
            </p>
            <p className="text-sm whitespace-pre-wrap">{m.body}</p>
            <NoticeActions
              id={m.id}
              canSend={m.status === "draft" && !m.pending_request}
              canCancel={m.status === "draft" || m.status === "sending"}
            />
          </article>
        ))}
      </section>
    </main>
  );
}
