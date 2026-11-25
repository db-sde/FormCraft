"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  closePrivacyAction,
  exportPrivacyAction,
  findPrivacyAction,
  openPrivacyRequestAction,
  requestErasureAction,
  verifyPrivacyAction,
} from "../../actions";

const field = "flex flex-col gap-1";
const select = "border-input bg-field h-9 rounded-sm border-[1.5px] px-2 text-sm";
const box = "border-border flex flex-col gap-3 rounded-lg border-[1.5px] p-4";

/** Logs a request as it arrived. */
export function OpenRequestForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [type, setType] = useState("access");
  const [email, setEmail] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className={`${box} sm:grid sm:grid-cols-2`}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await openPrivacyRequestAction({
            type,
            email,
            receivedAt: receivedAt || null,
            note,
          });
          if (result.ok && result.id) {
            toast.success(
              "Request logged. The deadline is 30 days from when it arrived.",
            );
            router.push(`/admin/privacy/${result.id}`);
          } else if (!result.ok) toast.error(result.error);
        });
      }}
    >
      <h2 className="font-semibold sm:col-span-2">Log a request</h2>
      <div className={field}>
        <label htmlFor="pr-type" className="text-sm font-semibold">
          The person asks to
        </label>
        <select
          id="pr-type"
          className={select}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="access">See their data (access)</option>
          <option value="erasure">Erase their data</option>
          <option value="rectification">Correct their data</option>
        </select>
      </div>
      <div className={field}>
        <label htmlFor="pr-email" className="text-sm font-semibold">
          Their email address
        </label>
        <Input
          id="pr-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className={field}>
        <label htmlFor="pr-received" className="text-sm font-semibold">
          Received (blank: now)
        </label>
        <Input
          id="pr-received"
          type="datetime-local"
          value={receivedAt}
          onChange={(e) => setReceivedAt(e.target.value)}
        />
      </div>
      <div className={field}>
        <label htmlFor="pr-note" className="text-sm font-semibold">
          How it arrived, what they said (optional)
        </label>
        <Textarea
          id="pr-note"
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="sm:col-span-2 sm:justify-self-start"
      >
        Log request
      </Button>
    </form>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (
    action: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
    after?: () => void,
  ) =>
    start(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(done);
        after?.();
        router.refresh();
      } else toast.error(result.error ?? "That didn't work.");
    });
  return { pending, run };
}

export function VerifyForm({ id }: { id: string }) {
  const { pending, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <form
      className={box}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => verifyPrivacyAction({ id, note }), "Identity check recorded.");
      }}
    >
      <h2 className="font-semibold">1. Check it&apos;s really them</h2>
      <p className="text-muted-foreground text-sm">
        For example, email the address and wait for a reply from it. Nothing is exported
        or erased until this is recorded.
      </p>
      <div className={field}>
        <label htmlFor="pr-verify" className="text-sm font-semibold">
          How you checked
        </label>
        <Input
          id="pr-verify"
          required
          minLength={5}
          maxLength={500}
          placeholder="Replied from the address on 25 Nov"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        Record identity check
      </Button>
    </form>
  );
}

export function FindButton({ id, again }: { id: string; again: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => run(() => findPrivacyAction({ id }), "Search finished.")}
    >
      {again ? "Search again" : "Find their data"}
    </Button>
  );
}

export function ExportButton({ id, email }: { id: string; email: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await exportPrivacyAction({ id });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          const blob = new Blob([result.json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `formcraft-data-${email.replace(/[^a-z0-9]+/gi, "-")}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success("Downloaded. Send it to the person, then close the request.");
        })
      }
    >
      Download their data (JSON)
    </Button>
  );
}

export function ErasureForm({ id, email }: { id: string; email: string }) {
  const { pending, run } = useRun();
  const [reason, setReason] = useState("");
  return (
    <form
      className={box}
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => requestErasureAction({ id, email, reason }),
          "Requested. Someone else approves it on Approvals, then it can be applied.",
          () => setReason(""),
        );
      }}
    >
      <h2 className="font-semibold">Erase everything found</h2>
      <p className="text-muted-foreground text-sm">
        Deletes their responses in every workspace, with files, webhook payloads,
        remembered answers and booking details. It can&apos;t be undone. Another owner,
        admin or privacy lead approves it first.
      </p>
      <div className={field}>
        <label htmlFor="pr-erase-reason" className="text-sm font-semibold">
          Reason
        </label>
        <Input
          id="pr-erase-reason"
          required
          minLength={5}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        variant="destructive"
        disabled={pending}
        className="self-start"
      >
        Request erasure
      </Button>
    </form>
  );
}

export function CloseForm({ id, canComplete }: { id: string; canComplete: boolean }) {
  const { pending, run } = useRun();
  const [status, setStatus] = useState(canComplete ? "completed" : "rejected");
  const [note, setNote] = useState("");
  return (
    <form
      className={box}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => closePrivacyAction({ id, status, note }), "Request closed.");
      }}
    >
      <h2 className="font-semibold">Close the request</h2>
      <div className={field}>
        <label htmlFor="pr-close-status" className="text-sm font-semibold">
          Outcome
        </label>
        <select
          id="pr-close-status"
          className={select}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {canComplete && <option value="completed">Done</option>}
          <option value="rejected">Refused (say why)</option>
        </select>
      </div>
      <div className={field}>
        <label htmlFor="pr-close-note" className="text-sm font-semibold">
          What was done, or why it was refused
        </label>
        <Textarea
          id="pr-close-note"
          rows={2}
          required
          minLength={5}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        Close request
      </Button>
    </form>
  );
}
