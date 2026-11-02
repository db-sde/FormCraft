"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Proposal = { schema: FormSchemaV1; changes: string[]; summary: string };

/**
 * "Edit with AI" (master spec F-23): describe a change; review exactly
 * what it would do; apply it to the draft (undoable) or discard it.
 * The live form only changes when the creator publishes.
 */
export function AiEditDialog({
  open,
  onOpenChange,
  propose,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propose: (
    instruction: string,
  ) => Promise<({ ok: true } & Proposal) | { ok: false; message: string }>;
  onApply: (schema: FormSchemaV1, summary: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setProposal(null);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Edit with AI</DialogTitle>
          <DialogDescription>
            Describe a change to questions, options, logic or the look. You&apos;ll see
            every change before it&apos;s applied, and you can undo it after.
          </DialogDescription>
        </DialogHeader>
        {!proposal ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const result = await propose(instruction);
                if (result.ok) setProposal(result);
                else setError(result.message);
              });
            }}
          >
            <Textarea
              aria-label="What should change"
              rows={4}
              maxLength={2000}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Make the email question required, add a phone question after it, and use a dark green theme"
            />
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending || !instruction.trim()}>
                {pending ? <ButtonSpinner /> : <Sparkles />}
                {pending ? "Drafting changes…" : "Draft changes"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            {proposal.summary && <p className="text-sm">{proposal.summary}</p>}
            <ul
              aria-label="Proposed changes"
              className="bg-background flex flex-col gap-1.5 rounded-sm p-3 text-sm"
            >
              {proposal.changes.map((change, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="text-muted-foreground">
                    •
                  </span>
                  {change}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              Applying changes the draft only. Publish when you&apos;re happy with it.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Discard
              </Button>
              <Button
                onClick={() => {
                  onApply(proposal.schema, proposal.summary);
                  reset();
                  setInstruction("");
                  onOpenChange(false);
                }}
              >
                Apply changes
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
