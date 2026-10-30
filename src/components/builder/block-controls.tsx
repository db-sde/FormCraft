"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Library, Lock, Unlink } from "lucide-react";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { parseFormSchema, validateSemantics } from "@/domains/forms/schema/validate";
import { FormSchemaError, schemaErrorMessage } from "@/domains/forms/schema/validate";
import {
  applyVersion,
  detach,
  diffVersions,
  type BlockChange,
} from "@/domains/blocks/content";
import {
  createBlockAction,
  getBlockVersionAction,
} from "@/app/(dashboard)/blocks/actions";
import { NON_ANSWERABLE_TYPES } from "@/domains/forms/schema/question-types";
import { toast } from "@/lib/toast";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type BlockStatus = {
  id: string;
  name: string;
  currentVersion: number;
  archived: boolean;
};

/** The schema with these questions, if it still passes the checks a
 * saved draft must pass; otherwise why not. */
function checked(
  schema: FormSchemaV1,
  questions: QuestionV1[],
): { ok: true; schema: FormSchemaV1 } | { ok: false; message: string } {
  const next = { ...schema, questions };
  try {
    validateSemantics(parseFormSchema(next));
    return { ok: true, schema: next };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof FormSchemaError
          ? schemaErrorMessage(error)
          : "The form wouldn't be valid with this change.",
    };
  }
}

/**
 * Shown above a question that's a copy of a shared block (F-09): its text
 * and settings are the block's, so they're locked here. The form's own
 * parts — show conditions, checks, translations — stay editable in Logic.
 * When the block has a newer version, the creator reviews what changes
 * and applies it to the draft (nothing changes on its own).
 */
export function BlockNotice({
  question,
  status,
  schema,
  onSchema,
}: {
  question: QuestionV1;
  status: BlockStatus | undefined;
  schema: FormSchemaV1;
  onSchema: (next: FormSchemaV1) => void;
}) {
  const ref = question.block!;
  const [reviewing, setReviewing] = useState(false);
  const name = status?.name ?? "a shared block";
  const updateAvailable =
    status && !status.archived && status.currentVersion > ref.version;
  const count = schema.questions.filter((q) => q.block?.instance === ref.instance).length;

  return (
    <div
      className="border-ink bg-background flex flex-col gap-2 rounded-sm border-[1.5px] p-3"
      data-testid="block-notice"
    >
      <p className="flex items-start gap-2 text-[13px] leading-normal">
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          From the block <b>“{name}”</b> (version {ref.version}
          {count > 1 ? `, ${count} questions` : ""}). Its text and settings are edited in
          the block; show conditions and checks are this form&apos;s.
        </span>
      </p>
      {status?.archived && (
        <p className="text-muted-foreground text-[12.5px]">
          The block has been archived. Detach it to keep editing these questions.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {updateAvailable && (
          <Button size="sm" onClick={() => setReviewing(true)}>
            Version {status.currentVersion} available: review
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onSchema({ ...schema, questions: detach(schema.questions, ref.instance) });
            toast.success("Detached.", {
              description:
                "These questions are now this form's own and won't get block updates.",
            });
          }}
        >
          <Unlink className="size-3.5" /> Detach
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/blocks/${ref.id}`}>Edit the block</Link>
        </Button>
      </div>
      {reviewing && status && (
        <ReviewUpdate
          blockId={ref.id}
          instance={ref.instance}
          from={ref.version}
          to={status.currentVersion}
          name={name}
          schema={schema}
          onClose={() => setReviewing(false)}
          onApply={(next) => {
            onSchema(next);
            setReviewing(false);
            toast.success(`Updated to version ${status.currentVersion}.`, {
              description: "Publish the form to make it live.",
            });
          }}
        />
      )}
    </div>
  );
}

function ReviewUpdate({
  blockId,
  instance,
  from,
  to,
  name,
  schema,
  onClose,
  onApply,
}: {
  blockId: string;
  instance: string;
  from: number;
  to: number;
  name: string;
  schema: FormSchemaV1;
  onClose: () => void;
  onApply: (next: FormSchemaV1) => void;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; changes: BlockChange[]; result: ReturnType<typeof checked> }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getBlockVersionAction(blockId, from),
      getBlockVersionAction(blockId, to),
    ]).then(([before, after]) => {
      if (cancelled) return;
      if (!before.ok || !after.ok) {
        setState({ kind: "error", message: "Couldn't load the block's versions." });
        return;
      }
      const questions = applyVersion(schema.questions, instance, {
        version: to,
        questions: after.questions,
      });
      setState({
        kind: "ready",
        changes: diffVersions(before.questions, after.questions),
        result: checked(schema, questions),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [blockId, from, to, instance, schema]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Update “{name}” to version {to}?
          </DialogTitle>
          <DialogDescription>
            This changes the draft only. The live form stays as it is until you publish.
          </DialogDescription>
        </DialogHeader>
        {state.kind === "loading" && <p className="text-sm">Loading…</p>}
        {state.kind === "error" && (
          <p className="text-destructive text-sm">{state.message}</p>
        )}
        {state.kind === "ready" && (
          <div className="flex flex-col gap-3 text-sm">
            {state.changes.length === 0 ? (
              <p>The questions are the same; only the version number changes.</p>
            ) : (
              <ul className="flex flex-col gap-1.5" aria-label="What changes">
                {state.changes.map((c, i) => (
                  <li key={i}>
                    {c.kind === "added" && (
                      <>
                        Added: <b>{c.label}</b>
                      </>
                    )}
                    {c.kind === "removed" && (
                      <>
                        Removed: <b>{c.label}</b> (its answers stay in past responses)
                      </>
                    )}
                    {c.kind === "changed" && (
                      <>
                        Changed: <b>{c.label}</b>
                        {c.was !== c.label && (
                          <span className="text-muted-foreground"> (was “{c.was}”)</span>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!state.result.ok && (
              <p role="alert" className="text-destructive font-semibold">
                Can&apos;t apply it yet: {state.result.message} Change that first, or
                detach the block.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button
            disabled={state.kind !== "ready" || !state.result.ok}
            onClick={() =>
              state.kind === "ready" && state.result.ok && onApply(state.result.schema)
            }
          >
            Apply to draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Saves questions of this form as a new shared block (F-09): the block's
 * first version, and these questions become its locked copies here.
 */
export function SaveBlockDialog({
  schema,
  initialIds,
  onClose,
  onSaved,
}: {
  schema: FormSchemaV1;
  initialIds: string[];
  onClose: () => void;
  onSaved: (next: FormSchemaV1) => void;
}) {
  const candidates = [...schema.questions]
    .sort((a, b) => a.order - b.order)
    .filter((q) => !q.block && q.type !== "welcome_screen");
  const [picked, setPicked] = useState<Set<string>>(new Set(initialIds));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  function save() {
    const chosen = candidates.filter((q) => picked.has(q.id));
    if (chosen.length === 0) return setError("Pick at least one question.");
    setError(null);
    start(async () => {
      const result = await createBlockAction({ name, description, questions: chosen });
      if (!result.ok) return setError(result.message);
      const instance = `bi_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
      const questions = schema.questions.map((q) =>
        picked.has(q.id)
          ? ({
              ...q,
              block: { id: result.id, version: result.version, instance, source: q.id },
            } as QuestionV1)
          : q,
      );
      onSaved({ ...schema, questions });
      toast.success(`Saved “${name.trim()}” to your library.`, {
        description: "Insert it in any form from Add question → From your library.",
      });
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save to block library</DialogTitle>
          <DialogDescription>
            A block is a set of questions your team reuses. Editing it later makes a new
            version; each form chooses when to take it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="block-name">Name</Label>
            <Input
              id="block-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="block-description">Description (optional)</Label>
            <Input
              id="block-description"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-semibold">Questions in the block</legend>
            <div className="max-h-56 overflow-y-auto">
              {candidates.map((q) => (
                <label key={q.id} className="flex items-center gap-2 py-1 text-sm">
                  <Checkbox
                    checked={picked.has(q.id)}
                    onCheckedChange={(on) =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(q.id);
                        else next.delete(q.id);
                        return next;
                      })
                    }
                  />
                  {q.label.trim() ||
                    (NON_ANSWERABLE_TYPES.has(q.type)
                      ? "Untitled screen"
                      : "Untitled question")}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-muted-foreground text-xs">
            Show conditions, checks and option points stay with each form, not the block.
          </p>
          {error && (
            <p role="alert" className="text-destructive text-sm font-semibold">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || !name.trim()}
            onClick={save}
            data-loading={saving || undefined}
          >
            {saving && <ButtonSpinner />}
            <Library className="size-4" /> Save block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
