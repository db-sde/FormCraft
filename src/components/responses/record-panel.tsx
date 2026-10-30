"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, RotateCw } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  addCommentAction,
  replayAttemptAction,
  setAssigneeAction,
  setReviewStatusAction,
} from "@/app/(form)/forms/[id]/(sections)/responses/records-actions";
import {
  MAX_COMMENT_LENGTH,
  REVIEW_STATUS_LABEL,
  REVIEW_STATUSES,
  type ResponseComment,
} from "@/domains/responses/review";
import type { TimelineEntry } from "@/domains/responses/timeline";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LocalTime } from "@/components/local-time";
import { cn } from "cn";

const NOBODY = "__nobody";

const SECTION = "border-ink bg-card rounded-lg border-[1.5px] px-[18px] py-4";
const HEADING =
  "text-muted-foreground mb-3 text-[11.5px] font-bold tracking-[0.1em] uppercase";

/** Status and assignee for one response (F-03). Read-only for viewers. */
export function RecordControls({
  formId,
  responseId,
  status,
  assigneeId,
  members,
  canChange,
}: {
  formId: string;
  responseId: string;
  status: string;
  assigneeId: string | null;
  members: { id: string; name: string }[];
  canChange: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) toast.error(result.message);
      router.refresh();
    });
  }

  return (
    <section
      className={cn(SECTION, "flex flex-wrap items-end gap-4")}
      aria-busy={pending}
    >
      <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
        <Label htmlFor="review-status">Status</Label>
        <Select
          value={status}
          disabled={!canChange || pending}
          onValueChange={(value) =>
            run(() => setReviewStatusAction(formId, responseId, value))
          }
        >
          <SelectTrigger id="review-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REVIEW_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {REVIEW_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
        <Label htmlFor="assignee">Assignee</Label>
        <Select
          value={assigneeId ?? NOBODY}
          disabled={!canChange || pending}
          onValueChange={(value) =>
            run(() =>
              setAssigneeAction(formId, responseId, value === NOBODY ? null : value),
            )
          }
        >
          <SelectTrigger id="assignee" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOBODY}>Nobody</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!canChange && (
        <p className="text-muted-foreground basis-full text-xs">
          Editors and up can change the status and assignee.
        </p>
      )}
    </section>
  );
}

/** The team's private comments on a response. Respondents never see them
 * and exports leave them out. */
export function ResponseComments({
  formId,
  responseId,
  comments,
  canComment,
}: {
  formId: string;
  responseId: string;
  comments: ResponseComment[];
  canComment: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await addCommentAction(formId, responseId, draft);
      if (result.ok) {
        setDraft("");
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <section className={SECTION} aria-labelledby="comments-heading">
      <h2 id="comments-heading" className={HEADING}>
        Internal comments
      </h2>
      {comments.length === 0 ? (
        <p className="text-muted-foreground mb-3 text-sm">
          No comments yet. Only your team can see them.
        </p>
      ) : (
        <ol className="mb-3 flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <MessageSquare className="text-muted-foreground mt-1 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs">
                  <b className="text-foreground">{c.author ?? "Former teammate"}</b> ·{" "}
                  <LocalTime iso={c.createdAt} variant="relative" />
                </p>
                <p className="text-[15px] break-words whitespace-pre-wrap">{c.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {canComment && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor="new-comment" className="sr-only">
            Add a comment
          </Label>
          <Textarea
            id="new-comment"
            value={draft}
            maxLength={MAX_COMMENT_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note for your team…"
            rows={2}
          />
          <Button
            type="submit"
            size="sm"
            className="self-end"
            disabled={pending || !draft.trim()}
          >
            {pending && <ButtonSpinner />}
            Comment
          </Button>
        </form>
      )}
    </section>
  );
}

const DOT: Record<TimelineEntry["outcome"], string> = {
  ok: "bg-[var(--chip-live-fg)]",
  failed: "bg-destructive",
  pending: "bg-[var(--chip-draft-fg)]",
  skipped: "bg-subtle-foreground",
};

const OUTCOME_LABEL: Record<TimelineEntry["outcome"], string> = {
  ok: "Done",
  failed: "Failed",
  pending: "Waiting",
  skipped: "Skipped",
};

/** What happened to this response, oldest first (F-31). */
export function ResponseTimeline({
  formId,
  responseId,
  entries,
  canReplay,
}: {
  formId: string;
  responseId: string;
  entries: TimelineEntry[];
  canReplay: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function replay(entry: TimelineEntry) {
    if (!entry.replay) return;
    const { target, id } = entry.replay;
    setBusy(entry.key);
    startTransition(async () => {
      const result = await replayAttemptAction(formId, responseId, target, id);
      setBusy(null);
      if (result.ok) toast.success("Sent again.");
      else toast.error(result.message);
      router.refresh();
    });
  }

  return (
    <section className={SECTION} aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className={HEADING}>
        Timeline
      </h2>
      <ol className="flex flex-col">
        {entries.map((entry, index) => (
          <li key={entry.key} className="relative flex gap-3 pb-3 last:pb-0">
            {index < entries.length - 1 && (
              <span
                aria-hidden
                className="bg-border absolute top-4 bottom-0 left-[4.5px] w-px"
              />
            )}
            <span
              aria-hidden
              className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[entry.outcome])}
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <b className="text-sm">{entry.title}</b>
              <span className="sr-only">({OUTCOME_LABEL[entry.outcome]})</span>
              <span className="text-muted-foreground text-xs">
                <LocalTime iso={entry.at} />
                {entry.actor ? ` · ${entry.actor}` : ""}
              </span>
              {entry.detail && (
                <p
                  className={cn(
                    "basis-full text-xs break-words",
                    entry.outcome === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {entry.detail}
                </p>
              )}
            </div>
            {entry.replay && canReplay && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={busy !== null}
                onClick={() => replay(entry)}
              >
                {busy === entry.key ? (
                  <ButtonSpinner />
                ) : (
                  <RotateCw className="size-3.5" />
                )}
                Send again
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
