import { z } from "zod";
import { LOGIC_OPERATORS, OPTION_BEARING_QUESTION_TYPES } from "./question-types";

/**
 * Canonical Phase 1 form schema, version 1. This is the single typed
 * contract for what a form *is* — see docs/form-schema.md for the
 * rationale (JSONB storage, strongly typed contract, stable ids).
 *
 * Stable-id fields (question.id, option.id, ending.id, logic.id) are
 * generated client-side with nanoid and must never be reused or derived
 * from array position.
 */

const stableId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "id must be URL-safe (letters, numbers, - or _)");

// Reject NUL bytes anywhere in user-supplied free text — Postgres text
// columns/JSONB cannot store them and some clients mishandle them.
const safeText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !v.includes("\u0000"), "text must not contain NUL characters");

const optionalSafeText = (max: number) => safeText(max).optional();

// Creator-supplied links rendered to respondents (ending redirect, logo,
// background image). z.url() alone accepts any scheme — including
// javascript: and data: — so restrict to plain web URLs.
const webUrl = z
  .string()
  .max(2000)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), "must start with http:// or https://");

export const OptionV1 = z.object({
  id: stableId,
  label: safeText(500),
});
export type OptionV1 = z.infer<typeof OptionV1>;

// --- per-type settings -----------------------------------------------

const WelcomeScreenSettings = z.object({
  buttonLabel: optionalSafeText(100),
});

const ShortTextSettings = z.object({
  placeholder: optionalSafeText(200),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).max(5000).optional(),
});

const LongTextSettings = z.object({
  placeholder: optionalSafeText(200),
  maxLength: z.number().int().min(1).max(50000).optional(),
});

const EmailSettings = z.object({});
const PhoneSettings = z.object({ defaultCountry: z.string().length(2).optional() });
const UrlSettings = z.object({});

const NumberSettings = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    decimals: z.number().int().min(0).max(10).optional(),
  })
  .refine(
    (v) => v.min === undefined || v.max === undefined || v.min <= v.max,
    "min can't be greater than max",
  );

const SingleSelectSettings = z.object({
  options: z.array(OptionV1).min(1).max(100),
  allowOther: z.boolean().default(false),
});

const MultiSelectSettings = z
  .object({
    options: z.array(OptionV1).min(1).max(100),
    allowOther: z.boolean().default(false),
    minSelections: z.number().int().min(0).optional(),
    maxSelections: z.number().int().min(1).optional(),
  })
  .refine(
    (v) =>
      v.minSelections === undefined ||
      v.maxSelections === undefined ||
      v.minSelections <= v.maxSelections,
    "min selections can't be greater than max selections",
  );

const DropdownSettings = z.object({
  options: z.array(OptionV1).min(1).max(200),
});

const YesNoSettings = z.object({
  yesLabel: optionalSafeText(50),
  noLabel: optionalSafeText(50),
});

const DateSettings = z.object({
  minDate: z.string().optional(),
  maxDate: z.string().optional(),
});

const RatingSettings = z.object({
  scale: z.union([z.literal(5), z.literal(10)]).default(5),
});

const OpinionScaleSettings = z
  .object({
    min: z.number().int().default(0),
    max: z.number().int().default(10),
    leftLabel: optionalSafeText(100),
    rightLabel: optionalSafeText(100),
  })
  .refine((v) => v.min < v.max, "min must be less than max");

const FileUploadSettings = z.object({
  acceptedMimeTypes: z.array(z.string()).min(1),
  maxSizeMb: z.number().int().min(1).max(100).default(10),
});

const StatementSettings = z.object({
  buttonLabel: optionalSafeText(100),
});

// --- discriminated question union --------------------------------------

const baseQuestionFields = {
  id: stableId,
  order: z.number().int().min(0),
  label: safeText(1000),
  description: optionalSafeText(2000),
  required: z.boolean().default(false),
};

export const QuestionV1 = z.discriminatedUnion("type", [
  z.object({
    ...baseQuestionFields,
    type: z.literal("welcome_screen"),
    settings: WelcomeScreenSettings,
  }),
  z.object({
    ...baseQuestionFields,
    type: z.literal("short_text"),
    settings: ShortTextSettings,
  }),
  z.object({
    ...baseQuestionFields,
    type: z.literal("long_text"),
    settings: LongTextSettings,
  }),
  z.object({ ...baseQuestionFields, type: z.literal("email"), settings: EmailSettings }),
  z.object({ ...baseQuestionFields, type: z.literal("phone"), settings: PhoneSettings }),
  z.object({ ...baseQuestionFields, type: z.literal("url"), settings: UrlSettings }),
  z.object({
    ...baseQuestionFields,
    type: z.literal("number"),
    settings: NumberSettings,
  }),
  z.object({
    ...baseQuestionFields,
    type: z.literal("single_select"),
    settings: SingleSelectSettings,
  }),
  z.object({
    ...baseQuestionFields,
    type: z.literal("multi_select"),
    settings: MultiSelectSettings,
  }),
  z.object({
    ...baseQuestionFields,
    type: z.literal("dropdown"),
    settings: DropdownSettings,
  }),
  z.object({ ...baseQuestionFields, type: z.literal("yes_no"), settings: YesNoSettings }),
  z.object({ ...baseQuestionFields, type: z.literal("date"), settings: DateSettings }),
  z.object({
    ...baseQuestionFields,
    type: z.literal("rating"),
    settings: RatingSettings,
  }),
  z.object({
    ...baseQuestionFields,
    type: z.literal("opinion_scale"),
    settings: OpinionScaleSettings,
  }),
  z.object({
    ...baseQuestionFields,
    type: z.literal("file_upload"),
    settings: FileUploadSettings,
  }),
  z.object({
    ...baseQuestionFields,
    type: z.literal("statement"),
    settings: StatementSettings,
  }),
]);
export type QuestionV1 = z.infer<typeof QuestionV1>;

// --- endings -------------------------------------------------------------

export const EndingV1 = z.object({
  id: stableId,
  title: safeText(200),
  description: optionalSafeText(2000),
  buttonLabel: optionalSafeText(100),
  redirectUrl: webUrl.optional(),
  isDefault: z.boolean().default(false),
});
export type EndingV1 = z.infer<typeof EndingV1>;

// --- theme -----------------------------------------------------------------

export const ThemeV1 = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#0f172a"),
  backgroundColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#ffffff"),
  textColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  fontFamily: z.enum(["inter", "system", "georgia", "mono"]).default("inter"),
  buttonStyle: z.enum(["rounded", "square", "pill"]).default("rounded"),
  logoUrl: webUrl.optional(),
  backgroundImageUrl: webUrl.optional(),
  preset: z.string().max(50).optional(),
});
export type ThemeV1 = z.infer<typeof ThemeV1>;

// --- logic -----------------------------------------------------------------

export const LogicActionV1 = z.discriminatedUnion("type", [
  z.object({ type: z.literal("jump_to_question"), questionId: stableId }),
  z.object({ type: z.literal("jump_to_ending"), endingId: stableId }),
]);
export type LogicActionV1 = z.infer<typeof LogicActionV1>;

export const LogicRuleV1 = z.object({
  id: stableId,
  questionId: stableId,
  operator: z.enum(LOGIC_OPERATORS),
  value: z.unknown().optional(),
  action: LogicActionV1,
});
export type LogicRuleV1 = z.infer<typeof LogicRuleV1>;

// --- top-level form schema ---------------------------------------------

export const FormSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  meta: z.object({
    title: safeText(200),
    description: optionalSafeText(2000),
  }),
  theme: ThemeV1,
  endings: z.array(EndingV1).min(1).max(20),
  questions: z.array(QuestionV1).min(1).max(200),
  logic: z.array(LogicRuleV1).max(500),
});
export type FormSchemaV1 = z.infer<typeof FormSchemaV1>;

export const OPTION_BEARING_TYPES = new Set<string>(OPTION_BEARING_QUESTION_TYPES);
