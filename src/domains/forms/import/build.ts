import { nanoid } from "nanoid";
import { QuestionV1, type EndingV1, type FormSchemaV1 } from "@/domains/forms/schema/v1";
import type { QuestionType } from "@/domains/forms/schema/question-types";
import { parseFormSchema, validateSemantics } from "@/domains/forms/schema/validate";
import { createQuestion } from "@/domains/forms/builder";
import { draftToRule, type RuleDraft } from "@/domains/ai/rule-draft";
import type { FieldStatus, ImportReport, ImportSource } from "./report";

/**
 * Public-link form import (master spec F-05) — the part shared by every
 * source. A source parser turns a public form into `ImportedForm`: a
 * list of questions in FormCraft's own types, each marked imported,
 * converted (brought over in a nearby shape, with a note) or unknown
 * (left out), plus the jumps it could read. `buildImportedSchema` makes
 * that a valid draft and the report the builder shows.
 *
 * What it never does: import responses, publish, or claim logic it
 * couldn't read was recovered — a jump that can't be expressed here is
 * listed in the report, not guessed.
 */

export * from "./report";

/** A question as a source parser hands it over. */
export type ImportedQuestion = {
  /** The source's own id for it, for jumps. */
  sourceId: string;
  type: QuestionType;
  label: string;
  description?: string;
  required?: boolean;
  settings?: Record<string, unknown>;
  status: Exclude<FieldStatus, "unknown">;
  note?: string;
};

/** "After X (with this answer), go to Y." `optionLabel` null: always. */
export type ImportedJump = {
  fromSourceId: string;
  optionLabel: string | null;
  to: { kind: "question"; sourceId: string } | { kind: "end"; endingSourceId?: string };
};

export type ImportedForm = {
  title: string;
  description?: string;
  layout: "conversational" | "classic";
  /** Questions in order; `null` entries are fields left out. */
  items: (ImportedQuestion | { unknown: true; label: string; note: string })[];
  endings: { sourceId: string; title: string; description?: string }[];
  jumps: ImportedJump[];
  /** Logic the parser saw but can't express (scores, comparisons). */
  logicNotes: string[];
  notes: string[];
  welcome?: { title: string; description?: string; buttonLabel?: string };
};

export const MAX_IMPORTED_QUESTIONS = 200;

/** A blank form's look; the source's styling isn't copied (see report). */
const starterTheme = {
  primaryColor: "#0f172a",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

export const clip = (text: unknown, max: number): string =>
  typeof text === "string"
    ? text
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, max)
    : "";

/** Plain text from the bits of markup sources put in titles. */
export function plainText(text: unknown, max: number): string {
  return clip(
    typeof text === "string"
      ? text
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]*>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\*\*?([^*]+)\*\*?/g, "$1")
      : "",
    max,
  );
}

export function optionId() {
  return `opt_${nanoid(10)}`;
}

/** Turns what a parser read into a draft schema and its report. */
export function buildImportedSchema(
  form: ImportedForm,
  source: { kind: ImportSource; url: string },
  now: Date = new Date(),
): { schema: FormSchemaV1; report: ImportReport } {
  const report: ImportReport = {
    source: source.kind,
    sourceUrl: source.url,
    importedAt: now.toISOString(),
    fields: [],
    logic: { imported: 0, notes: [...form.logicNotes] },
    notes: [...form.notes],
  };
  const title = clip(form.title, 200) || "Imported form";

  const welcome = createQuestion("welcome_screen", 0);
  const questions: QuestionV1[] = [
    {
      ...welcome,
      label: clip(form.welcome?.title ?? title, 1000) || title,
      description: clip(form.welcome?.description ?? form.description, 2000) || undefined,
      ...(form.welcome?.buttonLabel
        ? { settings: { buttonLabel: clip(form.welcome.buttonLabel, 100) } }
        : {}),
    } as QuestionV1,
  ];
  const idBySource = new Map<string, string>();
  let kept = 0;
  for (const item of form.items) {
    if ("unknown" in item) {
      report.fields.push({ label: item.label, status: "unknown", note: item.note });
      continue;
    }
    if (kept >= MAX_IMPORTED_QUESTIONS) {
      report.fields.push({
        label: item.label,
        status: "unknown",
        note: `Only the first ${MAX_IMPORTED_QUESTIONS} questions are imported.`,
      });
      continue;
    }
    const base = createQuestion(item.type, questions.length);
    const candidate = {
      ...base,
      label: clip(item.label, 1000),
      description: clip(item.description, 2000) || undefined,
      required: item.required ?? false,
      settings: { ...(base.settings as object), ...(item.settings ?? {}) },
    };
    // Each question must stand on its own; one that doesn't parse is
    // reported, not allowed to sink the whole import.
    const parsed = QuestionV1.safeParse(candidate);
    const check = parsed.success ? parsed.data : null;
    if (!check) {
      report.fields.push({
        label: item.label,
        status: "unknown",
        note: "Its settings couldn't be brought over.",
      });
      continue;
    }
    questions.push(check);
    idBySource.set(item.sourceId, check.id);
    kept += 1;
    report.fields.push({
      label: item.label || "Untitled",
      status: item.status,
      ...(item.note ? { note: item.note } : {}),
    });
  }

  const endings: EndingV1[] =
    form.endings.length > 0
      ? form.endings.slice(0, 20).map((e, i) => ({
          id: `ending_${i + 1}`,
          title: clip(e.title, 200) || "Thank you!",
          description: clip(e.description, 2000) || undefined,
          isDefault: i === 0,
        }))
      : [{ id: "ending_1", title: "Thank you!", isDefault: true }];
  const endingBySource = new Map(
    form.endings.map((e, i) => [e.sourceId, `ending_${i + 1}`]),
  );

  let schema = parseFormSchema({
    schemaVersion: 1,
    meta: { title, layout: form.layout },
    theme: starterTheme,
    endings,
    questions,
    logic: [],
    variables: [],
  });

  // Jumps, one rule at a time, each checked as a hand-made rule is.
  const numbered = questions.filter((q) => q.type !== "welcome_screen");
  const numberOf = (id: string) => numbered.findIndex((q) => q.id === id) + 1;
  const labelOf = (sourceId: string) =>
    numbered.find((q) => q.id === idBySource.get(sourceId))?.label.trim() || "a question";
  const rules = [];
  for (const jump of form.jumps) {
    const from = idBySource.get(jump.fromSourceId);
    if (!from) {
      report.logic.notes.push(
        "A jump from a question that wasn't imported was left out.",
      );
      continue;
    }
    let action: RuleDraft["actions"][number];
    if (jump.to.kind === "end") {
      action = {
        type: "jump_to_ending",
        questionNumber: null,
        endingId:
          (jump.to.endingSourceId && endingBySource.get(jump.to.endingSourceId)) ||
          endings[0].id,
        variable: null,
        op: null,
        formula: null,
        candidates: [],
      };
    } else {
      const target = idBySource.get(jump.to.sourceId);
      if (!target) {
        report.logic.notes.push(
          `A jump from “${labelOf(jump.fromSourceId)}” goes to something that wasn't imported, so it was left out.`,
        );
        continue;
      }
      if (numberOf(target) <= numberOf(from)) {
        report.logic.notes.push(
          `A jump from “${labelOf(jump.fromSourceId)}” goes back to an earlier question. FormCraft only jumps forward, so it was left out.`,
        );
        continue;
      }
      action = {
        type: "jump_to_question",
        questionNumber: numberOf(target),
        endingId: null,
        variable: null,
        op: null,
        formula: null,
        candidates: [],
      };
    }
    const result = draftToRule(
      {
        possible: true,
        reason: "",
        name: jump.optionLabel
          ? `Imported: ${clip(jump.optionLabel, 60)}`
          : `Imported: after ${clip(labelOf(jump.fromSourceId), 60)}`,
        trigger: { event: "question_answered", questionNumber: numberOf(from) },
        match: "all",
        conditions: jump.optionLabel
          ? [
              {
                left: `q${numberOf(from)}`,
                op: "eq",
                value: jump.optionLabel,
                values: [],
                value2: null,
                valueIsFormula: false,
              },
            ]
          : [],
        actions: [action],
        newVariables: [],
      },
      { ...schema, rules },
    );
    if (result.ok) {
      rules.push(result.proposal.rule);
      report.logic.imported += 1;
    } else {
      report.logic.notes.push(
        `A jump from “${labelOf(jump.fromSourceId)}” couldn't be rebuilt: ${result.message}`,
      );
    }
  }
  if (rules.length > 0) schema = { ...schema, rules };
  try {
    validateSemantics(schema);
  } catch {
    report.logic.notes.push(
      "The imported logic didn't pass this form's checks, so it was left out.",
    );
    report.logic.imported = 0;
    schema = { ...schema, rules: undefined };
    validateSemantics(schema);
  }
  return { schema, report };
}
