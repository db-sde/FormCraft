import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import {
  CloseForm,
  ErasureForm,
  ExportButton,
  FindButton,
  VerifyForm,
} from "../privacy-forms";
import { TYPE_LABEL } from "../labels";

export const metadata: Metadata = { title: "Privacy request" };

type Scope = {
  responses: number;
  bookings: number;
  account_exists: boolean;
  workspaces: {
    id: string;
    name: string;
    slug: string;
    responses: number;
    bookings: number;
  }[];
};

type Request = {
  id: string;
  type: "access" | "erasure" | "rectification";
  requester_email: string;
  received_at: string;
  due_at: string;
  note: string | null;
  identity_verified_at: string | null;
  identity_note: string | null;
  scope: Scope | null;
  scoped_at: string | null;
  status: "open" | "completed" | "rejected";
  outcome_note: string | null;
  evidence: Record<string, unknown> | null;
  completed_at: string | null;
  created_by_name: string | null;
  handled_by_name: string | null;
  erasure_pending: boolean;
};

const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");

/** One request, step by step: check identity, find the data, then export,
 * erase (with approval) or close. */
export default async function PrivacyRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff("privacy.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const result = await adminCall<{ request: Request }>("admin_privacy_get", { p_id: id });
  if (!result.ok) notFound();
  const r = result.request;
  const open = r.status === "open";
  const verified = Boolean(r.identity_verified_at);

  return (
    <main className="flex flex-col gap-5">
      <Link href="/admin/privacy" className="text-sm underline">
        ← Privacy
      </Link>
      <h1 className="font-heading text-2xl font-bold">
        {TYPE_LABEL[r.type] ?? r.type}: {r.requester_email}
      </h1>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Received</dt>
        <dd>{when(r.received_at)}</dd>
        <dt className="text-muted-foreground">Due</dt>
        <dd>{when(r.due_at)}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          {open ? "Open" : r.status === "completed" ? "Done" : "Refused"}
          {r.completed_at ? ` on ${when(r.completed_at)}` : ""}
        </dd>
        <dt className="text-muted-foreground">Logged by</dt>
        <dd>{r.created_by_name ?? "—"}</dd>
        {r.note && (
          <>
            <dt className="text-muted-foreground">Note</dt>
            <dd className="whitespace-pre-wrap">{r.note}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Identity</dt>
        <dd>
          {verified
            ? `Checked ${when(r.identity_verified_at)}: ${r.identity_note}`
            : "Not checked yet"}
        </dd>
      </dl>

      {open && !verified && <VerifyForm id={r.id} />}

      <section className="border-border flex flex-col gap-3 rounded-lg border-[1.5px] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">2. Where their data is</h2>
          {open && <FindButton id={r.id} again={Boolean(r.scope)} />}
        </div>
        {!r.scope ? (
          <p className="text-muted-foreground text-sm">Not searched yet.</p>
        ) : (
          <>
            <p className="text-sm">
              {r.scope.responses} response(s) and {r.scope.bookings} booking(s) in{" "}
              {r.scope.workspaces.length} workspace(s), searched {when(r.scoped_at)}.
              {r.scope.account_exists &&
                " They also have a FormCraft account: they delete it themselves in Settings, or ask support."}
            </p>
            {r.scope.workspaces.length > 0 && (
              <ul className="text-sm">
                {r.scope.workspaces.map((w) => (
                  <li key={w.id} className="flex justify-between gap-2 border-b py-1">
                    <Link className="underline" href={`/admin/customers/${w.id}`}>
                      {w.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {w.responses} responses · {w.bookings} bookings
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground text-sm">
              The workspace owns these responses (it collected them). Tell its owner when
              you act on a request; an erasure also appears in its own audit log.
            </p>
          </>
        )}
      </section>

      {open && verified && r.scope && r.type !== "erasure" && (
        <section className="border-border flex flex-col gap-3 rounded-lg border-[1.5px] p-4">
          <h2 className="font-semibold">3. Give them a copy</h2>
          <p className="text-muted-foreground text-sm">
            Every response and booking with their address, as JSON. Downloading it is
            logged. Send it to them, then close the request below.
          </p>
          <div>
            <ExportButton id={r.id} email={r.requester_email} />
          </div>
        </section>
      )}

      {open &&
        verified &&
        r.scope &&
        r.type === "erasure" &&
        (r.erasure_pending ? (
          <p className="text-sm font-semibold">
            Erasure requested. Once someone else approves it on{" "}
            <Link className="underline" href="/admin/approvals">
              Approvals
            </Link>
            , apply it there.
          </p>
        ) : (
          <ErasureForm id={r.id} email={r.requester_email} />
        ))}

      {r.evidence && (
        <section className="border-border flex flex-col gap-2 rounded-lg border-[1.5px] p-4">
          <h2 className="font-semibold">What was erased</h2>
          <ul className="text-sm">
            {[
              ["Responses", r.evidence.responses],
              ["Files queued for removal", r.evidence.files_queued],
              ["Webhook payloads", r.evidence.webhook_payloads],
              ["Remembered answers", r.evidence.remembered_answers],
              ["Bookings anonymised", r.evidence.bookings_anonymised],
            ].map(([label, n]) => (
              <li key={String(label)} className="flex justify-between border-b py-1">
                <span>{String(label)}</span>
                <b>{String(n ?? 0)}</b>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm">
            {String(r.evidence.backups ?? "")}
          </p>
        </section>
      )}

      {r.outcome_note && (
        <p className="text-sm">
          <b>Outcome:</b> {r.outcome_note}
        </p>
      )}

      {open && <CloseForm id={r.id} canComplete={r.type !== "erasure"} />}
    </main>
  );
}
