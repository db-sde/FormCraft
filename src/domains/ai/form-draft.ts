import { z } from "zod";
import { nanoid } from "nanoid";
import { variableName, type VariableV1 } from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1, OptionV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { createOption, createQuestion } from "@/domains/forms/builder";
import { parseFormSchema, validateSemantics } from "@/domains/forms/schema/validate";
import { analyzeLogic } from "@/domains/forms/schema/analyze";
import { draftToRule, RuleDraft } from "./rule-draft";

/**
 * AI form generation (Phase 31). As with rules, the model fills a flat
 * draft and this module builds the real schema: ids are generated here,
 * question defaults come from the builder's own createQuestion, and the
 * result must parse and pass the semantic checks a saved draft passes.
 * Rules that don't survive translation are dropped and reported rather
 * than sinking the whole form.
 */

export const GENERATED_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "contact_info",
  "number",
  "single_select",
  "multi_select",
  "dropdown",
  "yes_no",
  "date",
  "rating",
  "opinion_scale",
  "statement",
] as const;

const RuleBody = RuleDraft.omit({ possible: true, reason: true, newVariables: true });

export const FormDraft = z.object({
  possible: z.boolean().describe("False if the request isn't a form you can build."),
  reason: z
    .string()
    .describe("When not possible: why, in one sentence. Otherwise empty."),
  title: z.string(),
  intro: z.string().describe("One or two friendly sentences for the welcome screen."),
  questions: z.array(
    z.object({
      type: z.enum(GENERATED_QUESTION_TYPES),
      label: z.string(),
      description: z.string().describe("Optional helper text; empty for none."),
      required: z.boolean(),
      options: z
        .array(
          z.object({
            label: z.string(),
            correct: z.boolean().describe("Quizzes: true for the right answer."),
            points: z
              .array(z.object({ variable: z.string(), points: z.number() }))
              .describe("Points this option adds to number variables. Otherwise []."),
          }),
        )
        .describe("For single_select, multi_select and dropdown. Otherwise []."),
      scale: z.number().int().nullable().describe("For rating: 5 or 10."),
    }),
  ),
  variables: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["number", "string", "boolean", "list"]),
      initial: z.number().nullable(),
    }),
  ),
  endings: z.array(
    z.object({ title: z.string(), description: z.string(), isDefault: z.boolean() }),
  ),
  rules: z.array(RuleBody),
});
export type FormDraft = z.infer<typeof FormDraft>;

export type FormBuildResult =
  { ok: true; schema: FormSchemaV1; warnings: string[] } | { ok: false; message: string };

/** Same as a blank form's (domains/forms/queries.ts starterFormSchema). */
const starterTheme = {
  primaryColor: "#0f172a",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

const MAX_QUESTIONS = 40;
const MAX_ENDINGS = 10;
const MAX_RULES = 40;
const clip = (text: string, max: number) => text.trim().slice(0, max);

function question(
  q: FormDraft["questions"][number],
  order: number,
  variables: VariableV1[],
): QuestionV1 {
  const base = createQuestion(q.type, order);
  const label = clip(q.label, 1000) || base.label;
  const description = clip(q.description, 2000) || undefined;
  const settings = { ...(base.settings as Record<string, unknown>) };
  if ("options" in settings) {
    const options: OptionV1[] = q.options.slice(0, 100).map((o) => {
      const option: OptionV1 = createOption(clip(o.label, 500) || "Option");
      if (o.correct) option.correct = true;
      const scores = o.points
        .map((p) => ({
          variableId: variables.find((v) => v.name === p.variable && v.type === "number")
            ?.id,
          points: p.points,
        }))
        .filter(
          (s): s is { variableId: string; points: number } =>
            !!s.variableId && Number.isFinite(s.points),
        );
      if (scores.length > 0) option.scores = scores;
      return option;
    });
    if (options.length > 0) settings.options = options;
  }
  if (q.type === "rating") settings.scale = q.scale === 10 ? 10 : 5;
  return {
    ...base,
    label,
    description,
    required: q.type === "statement" ? false : q.required,
    settings,
  } as QuestionV1;
}

/** The draft → a complete, valid form schema. */
export function buildGeneratedForm(draft: FormDraft): FormBuildResult {
  if (!draft.possible) {
    return { ok: false, message: draft.reason || "That isn't a form I can build." };
  }
  if (draft.questions.length === 0) {
    return {
      ok: false,
      message: "No questions came back. Try describing the form more.",
    };
  }
  const warnings: string[] = [];
  const title = clip(draft.title, 200) || "Untitled form";

  const variables: VariableV1[] = [];
  for (const v of draft.variables) {
    if (
      !variableName.safeParse(v.name).success ||
      variables.some((x) => x.name === v.name)
    ) {
      warnings.push(`Skipped the variable “${v.name}”: its name isn't usable.`);
      continue;
    }
    variables.push({
      id: `v_${nanoid(10)}`,
      name: v.name,
      type: v.type,
      ...(v.type === "number" && v.initial !== null ? { initial: v.initial } : {}),
    });
  }

  const welcome = createQuestion("welcome_screen", 0);
  const questions: QuestionV1[] = [
    { ...welcome, label: title, description: clip(draft.intro, 2000) || undefined },
    ...draft.questions
      .slice(0, MAX_QUESTIONS)
      .map((q, i) => question(q, i + 1, variables)),
  ];

  const endingsDraft = draft.endings.slice(0, MAX_ENDINGS);
  const defaultIndex = Math.max(
    0,
    endingsDraft.findIndex((e) => e.isDefault),
  );
  const endings =
    endingsDraft.length === 0
      ? [{ id: "ending_1", title: "Thank you!", isDefault: true }]
      : endingsDraft.map((e, i) => ({
          id: `ending_${i + 1}`,
          title: clip(e.title, 200) || "Thank you!",
          description: clip(e.description, 2000) || undefined,
          isDefault: i === defaultIndex,
        }));

  let schema: FormSchemaV1;
  try {
    schema = parseFormSchema({
      schemaVersion: 1,
      meta: { title },
      theme: starterTheme,
      endings,
      questions,
      logic: [],
      variables,
    });
  } catch {
    return { ok: false, message: "The generated form wasn't valid. Try again." };
  }

  // Rules one at a time, each against the form with the earlier ones in.
  const rules = [];
  for (const body of draft.rules.slice(0, MAX_RULES)) {
    const result = draftToRule(
      { ...body, possible: true, reason: "", newVariables: [] },
      { ...schema, rules },
    );
    if (result.ok) rules.push(result.proposal.rule);
    else warnings.push(`Left out a rule (${body.name || "unnamed"}): ${result.message}`);
  }
  if (rules.length > 0) schema = { ...schema, rules };

  try {
    validateSemantics(schema);
  } catch {
    // Shouldn't happen (each rule was checked); fall back to no logic.
    warnings.push("Left out the logic: it didn't pass the form's checks.");
    schema = { ...schema, rules: undefined };
  }
  for (const issue of analyzeLogic(schema)) warnings.push(issue.message);
  return { ok: true, schema, warnings };
}
