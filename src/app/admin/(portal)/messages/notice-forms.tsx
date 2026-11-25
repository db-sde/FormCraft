"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelNoticeAction,
  draftNoticeAction,
  requestNoticeSendAction,
} from "../../actions";

const field = "flex flex-col gap-1";
const select = "border-input bg-field h-9 rounded-sm border-[1.5px] px-2 text-sm";

/** Writes a notice (it can't be edited afterwards: cancel and rewrite). */
export function DraftNoticeForm({ plans }: { plans: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState("service");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");
  const [planList, setPlanList] = useState("");
  const [workspaceIds, setWorkspaceIds] = useState("");
  return (
    <form
      className="border-border grid gap-3 rounded-lg border-[1.5px] p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await draftNoticeAction({
            kind,
            subject,
            body,
            audience,
            plans: planList,
            workspaceIds,
          });
          if (result.ok) {
            toast.success(`Saved. It would reach ${result.recipients ?? 0} owner(s).`);
            setSubject("");
            setBody("");
            router.refresh();
          } else toast.error(result.error);
        });
      }}
    >
      <h2 className="font-semibold sm:col-span-2">Write a notice</h2>
      <p className="text-muted-foreground text-sm sm:col-span-2">
        Service notices only: incidents, billing, policy changes. Goes to workspace
        owners. No marketing.
      </p>
      <div className={field}>
        <label htmlFor="nt-kind" className="text-sm font-semibold">
          Kind
        </label>
        <select
          id="nt-kind"
          className={select}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="service">Service notice</option>
          <option value="incident">Incident</option>
          <option value="billing">Billing</option>
          <option value="policy">Policy update</option>
        </select>
      </div>
      <div className={field}>
        <label htmlFor="nt-audience" className="text-sm font-semibold">
          Who gets it
        </label>
        <select
          id="nt-audience"
          className={select}
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        >
          <option value="all">Owners of every workspace</option>
          <option value="plans">Owners of workspaces on some plans</option>
          <option value="workspaces">Owners of chosen workspaces</option>
        </select>
      </div>
      {audience === "plans" && (
        <div className={`${field} sm:col-span-2`}>
          <label htmlFor="nt-plans" className="text-sm font-semibold">
            Plans (comma-separated: {plans.join(", ")})
          </label>
          <Input
            id="nt-plans"
            value={planList}
            onChange={(e) => setPlanList(e.target.value)}
          />
        </div>
      )}
      {audience === "workspaces" && (
        <div className={`${field} sm:col-span-2`}>
          <label htmlFor="nt-workspaces" className="text-sm font-semibold">
            Workspace IDs (from Customers, one per line)
          </label>
          <Textarea
            id="nt-workspaces"
            rows={3}
            value={workspaceIds}
            onChange={(e) => setWorkspaceIds(e.target.value)}
          />
        </div>
      )}
      <div className={`${field} sm:col-span-2`}>
        <label htmlFor="nt-subject" className="text-sm font-semibold">
          Subject
        </label>
        <Input
          id="nt-subject"
          required
          minLength={3}
          maxLength={150}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <div className={`${field} sm:col-span-2`}>
        <label htmlFor="nt-body" className="text-sm font-semibold">
          Message (plain text)
        </label>
        <Textarea
          id="nt-body"
          rows={6}
          required
          minLength={10}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="sm:col-span-2 sm:justify-self-start"
      >
        Save draft
      </Button>
    </form>
  );
}

/** Ask to send (approved by someone else), or cancel. */
export function NoticeActions({
  id,
  canSend,
  canCancel,
}: {
  id: string;
  canSend: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      {canSend && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const result = await requestNoticeSendAction({ id, reason });
              if (result.ok) {
                toast.success("Requested. Someone else approves it on Approvals.");
                router.refresh();
              } else toast.error(result.error);
            });
          }}
        >
          <div className={field}>
            <label htmlFor={`nt-reason-${id}`} className="text-xs font-semibold">
              Why it needs sending
            </label>
            <Input
              id={`nt-reason-${id}`}
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            Ask to send
          </Button>
        </form>
      )}
      {canCancel && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await cancelNoticeAction({ id });
              if (result.ok) {
                toast.success("Cancelled.");
                router.refresh();
              } else toast.error(result.error);
            })
          }
        >
          Cancel
        </Button>
      )}
    </div>
  );
}
