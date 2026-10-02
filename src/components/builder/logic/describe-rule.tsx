"use client";

import { useState, useTransition } from "react";
import { Check, Sparkles, TriangleAlert, X } from "lucide-react";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import type { RuleProposal } from "@/domains/ai/rule-draft";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { describeRule } from "./logic-ui";

export type ProposeRule = (
  instruction: string,
) => Promise<{ ok: true; proposal: RuleProposal } | { ok: false; message: string }>;

const EXAMPLES = [
  "If they pick Student, skip to the last question",
  "Add 10 to score when they answer yes to the demo question",
  "Students and teachers get the discount ending",
];

/**
 * "Describe a rule" (Phase 30). The AI only proposes: the creator sees
 * the rule in the same words as every other rule, plus any variable it
 * would add and any check it trips, and chooses to add it or not. The
 * proposal was already validated on the server; added rules are saved
 * (and validated again) by autosave like hand-made ones.
 */
export function DescribeRule({
  schema,
  enabled,
  propose,
  onAccept,
}: {
  schema: FormSchemaV1;
  enabled: boolean;
  propose?: ProposeRule;
  onAccept: (proposal: RuleProposal) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<RuleProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!enabled || !propose) {
    return (
      <div className="border-input text-muted-foreground flex items-center gap-2.5 rounded-lg border-[1.5px] border-dashed px-4 py-3 text-[13.5px]">
        <Sparkles className="size-4 shrink-0" />
        Describing rules in words needs AI, which isn&apos;t set up on this server (set
        ANTHROPIC_API_KEY).
      </div>
    );
  }

  function submit() {
    if (!instruction.trim() || pending) return;
    setError(null);
    setProposal(null);
    startTransition(async () => {
      const result = await propose!(instruction);
      if (result.ok) setProposal(result.proposal);
      else setError(result.message);
    });
  }

  // How the proposal reads, against the form plus any variables it adds.
  const preview: FormSchemaV1 | null = proposal
    ? { ...schema, variables: [...(schema.variables ?? []), ...proposal.newVariables] }
    : null;

  return (
    <section
      aria-label="Describe a rule"
      className="border-ink bg-card shadow-card flex flex-col gap-2.5 rounded-lg border-[1.5px] p-4"
    >
      <label
        htmlFor="describe-rule"
        className="flex items-center gap-2 text-sm font-bold"
      >
        <Sparkles className="size-4" /> Describe a rule
      </label>
      <Textarea
        id="describe-rule"
        value={instruction}
        maxLength={600}
        rows={2}
        placeholder={EXAMPLES[0]}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !instruction.trim()}>
          <Sparkles /> {pending ? "Drafting…" : "Draft rule"}
        </Button>
        {!instruction &&
          EXAMPLES.slice(1).map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setInstruction(example)}
              className="fc-focus text-muted-foreground hover:text-foreground hover:bg-hover-wash rounded-sm px-1.5 py-1 text-[12.5px]"
            >
              “{example}”
            </button>
          ))}
      </div>

      {error && (
        <p
          role="alert"
          className="text-destructive flex items-start gap-1.5 text-[13.5px]"
        >
          <X className="mt-0.5 size-3.5 shrink-0" /> {error}
        </p>
      )}

      {proposal && preview && (
        <div className="border-input bg-background flex flex-col gap-2 rounded-sm border-[1.5px] p-3 text-[13.5px]">
          <p className="leading-relaxed">
            {proposal.rule.name && <b>{proposal.rule.name}: </b>}
            {describeRule(proposal.rule, preview)}
          </p>
          {proposal.newVariables.length > 0 && (
            <p className="text-muted-foreground">
              Adds {proposal.newVariables.length === 1 ? "a variable" : "variables"}:{" "}
              {proposal.newVariables.map((v) => `${v.name} (${v.type})`).join(", ")}
            </p>
          )}
          {proposal.warnings.map((warning) => (
            <p
              key={warning}
              className="flex items-start gap-1.5 text-[var(--chip-draft-fg)]"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {warning}
            </p>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onAccept(proposal);
                setProposal(null);
                setInstruction("");
              }}
            >
              <Check /> Add rule
            </Button>
            <Button size="sm" variant="outline" onClick={() => setProposal(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
