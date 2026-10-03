import { z } from "zod";
import {
  CONTACT_FIELDS,
  LOGIC_OPERATORS,
  OPTION_BEARING_QUESTION_TYPES,
} from "./question-types";
import { optionalSafeText, safeText, stableId } from "./primitives";
import {
  Condition,
  HiddenFieldV1,
  OptionScoreV1,
  QuestionValidationV1,
  RuleV1,
  VariableV1,
  QuestionPoolV1,
} from "./logic-model";

/**
 * Canonical Phase 1 form schema, version 1. This is the single typed
 * contract for what a form *is* — see docs/form-schema.md for the
 * rationale (JSONB storage, strongly typed contract, stable ids).
 *
 * Stable-id fields (question.id, option.id, ending.id, logic.id) are
 * generated client-side with nanoid and must never be reused or derived
 * from array position.
 */

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
  /** Points this option adds to variables when chosen (scoring, quizzes). */
  scores: z.array(OptionScoreV1).max(10).optional(),
  /** Knowledge quizzes: marks the right answer(s). */
  correct: z.boolean().optional(),
});
export type OptionV1 = z.infer<typeof OptionV1>;

// --- per-type settings -----------------------------------------------

// Optional picture on intro/informational screens (PRD P1.5), with alt
// text for screen readers (§3.4).
const screenImage = {
  imageUrl: webUrl.optional(),
  imageAlt: optionalSafeText(300),
};

const WelcomeScreenSettings = z.object({
  buttonLabel: optionalSafeText(100),
  ...screenImage,
});

const ShortTextSettings = z.object({
  placeholder: optionalSafeText(200),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).max(5000).optional(),
});

const LongTextSettings = z.object({
  placeholder: optionalSafeText(200),
  maxLength: z.number().int().min(1).max(50000).optional(),
  /** Ask one AI-written follow-up question about the answer (P3.7). */
  aiFollowUp: z.boolean().optional(),
});

const EmailSettings = z.object({});
const PhoneSettings = z.object({ defaultCountry: z.string().length(2).optional() });
const UrlSettings = z.object({});

// Lead capture: one step asking for several contact details at once.
// Saved like any other answer as soon as the respondent moves on, so
// the lead is kept even if they never reach the end of the form.
const ContactInfoSettings = z
  .object({
    fields: z.array(z.enum(CONTACT_FIELDS)).min(1).max(CONTACT_FIELDS.length),
    requiredFields: z.array(z.enum(CONTACT_FIELDS)).default([]),
  })
  .refine(
    (v) => v.requiredFields.every((f) => v.fields.includes(f)),
    "a required contact field must also be shown",
  );

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

/** Options carried forward from an earlier choice question (logic spec
 * phase 8): its options, kept in sync by the builder, shown filtered by
 * what the respondent picked there. */
const OptionsFrom = z.object({
  questionId: stableId,
  include: z.enum(["selected", "not_selected"]),
});

const SingleSelectSettings = z.object({
  options: z.array(OptionV1).min(1).max(100),
  allowOther: z.boolean().default(false),
  /** Shown in a random order per respondent (answers are option ids). */
  randomizeOptions: z.boolean().optional(),
  optionsFrom: OptionsFrom.optional(),
});

const MultiSelectSettings = z
  .object({
    options: z.array(OptionV1).min(1).max(100),
    allowOther: z.boolean().default(false),
    randomizeOptions: z.boolean().optional(),
    optionsFrom: OptionsFrom.optional(),
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
  randomizeOptions: z.boolean().optional(),
  optionsFrom: OptionsFrom.optional(),
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
  ...screenImage,
});

// --- discriminated question union --------------------------------------

const baseQuestionFields = {
  id: stableId,
  order: z.number().int().min(0),
  label: safeText(1000),
  description: optionalSafeText(2000),
  required: z.boolean().default(false),
  /** Shown only when this holds; otherwise skipped (never required). */
  visibleIf: Condition.optional(),
  /** Conditional and cross-field checks, run when leaving the question. */
  validations: z.array(QuestionValidationV1).max(10).optional(),
  /** Multiplies the option scores this question adds (default 1). */
  weight: z.number().finite().min(0).max(100).optional(),
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
    type: z.literal("contact_info"),
    settings: ContactInfoSettings,
  }),
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
  /** Seconds the ending shows before redirecting (P2.9); 3 when unset. */
  redirectDelaySeconds: z.number().int().min(0).max(30).optional(),
  isDefault: z.boolean().default(false),
  /** The "Made with FormCraft" badge on this ending; shown unless false. */
  showMadeWith: z.boolean().optional(),
  /** A Calendly / Cal.com booking page shown on this ending (P2.16). */
  scheduler: z.object({ provider: z.enum(["calendly", "cal"]), url: webUrl }).optional(),
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
  /** The first four are on every plan; the rest need custom fonts
   * (P2.22) — the server shows Inter instead when the plan lacks them. */
  fontFamily: z
    .enum([
      "inter",
      "system",
      "georgia",
      "mono",
      "poppins",
      "lora",
      "playfair",
      "nunito",
      "dm_serif",
      "custom",
    ])
    .default("inter"),
  /** An uploaded, licensed WOFF2 font (with fontFamily "custom"). */
  customFont: z.object({ name: safeText(60), url: webUrl }).optional(),
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

// --- languages (P2.21) ------------------------------------------------------

const languageCode = z.enum([
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "nl",
  "hi",
  "ja",
  "zh",
  "ar",
]);
const translatedText = (max: number) => safeText(max).optional();

export const TranslationV1 = z.object({
  meta: z
    .object({ title: translatedText(200), description: translatedText(2000) })
    .optional(),
  questions: z
    .record(
      stableId,
      z.object({
        label: translatedText(1000),
        description: translatedText(2000),
        placeholder: translatedText(200),
        buttonLabel: translatedText(100),
        yesLabel: translatedText(50),
        noLabel: translatedText(50),
        options: z.record(stableId, safeText(500)).optional(),
      }),
    )
    .optional(),
  endings: z
    .record(
      stableId,
      z.object({
        title: translatedText(200),
        description: translatedText(2000),
        buttonLabel: translatedText(100),
      }),
    )
    .optional(),
});
export type TranslationV1 = z.infer<typeof TranslationV1>;

export const FormSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  meta: z.object({
    title: safeText(200),
    description: optionalSafeText(2000),
    /** IANA zone for date logic ("today", "this week"); UTC when unset. */
    timezone: z.string().max(64).optional(),
    /** Where people go after any ending without its own redirect (P2.9). */
    defaultRedirect: z
      .object({
        url: webUrl.refine((v) => /^https:\/\//i.test(v), "must start with https://"),
        delaySeconds: z.number().int().min(0).max(30).default(3),
      })
      .optional(),
  }),
  theme: ThemeV1,
  endings: z.array(EndingV1).min(1).max(20),
  questions: z.array(QuestionV1).min(1).max(200),
  /** Legacy single-question rules; still evaluated (as rules) forever. */
  logic: z.array(LogicRuleV1).max(500),
  variables: z.array(VariableV1).max(100).optional(),
  rules: z.array(RuleV1).max(500).optional(),
  hiddenFields: z.array(HiddenFieldV1).max(20).optional(),
  /** Ask a random few of a group of questions (logic spec phase 19). */
  pools: z.array(QuestionPoolV1).max(20).optional(),
  /** The language the form is written in, and the others it offers. */
  languages: z
    .object({ default: languageCode, others: z.array(languageCode).max(10) })
    .optional(),
  /** Text in the other languages, by stable id (P2.21). */
  translations: z.partialRecord(languageCode, TranslationV1).optional(),
});
export type FormSchemaV1 = z.infer<typeof FormSchemaV1>;

export const OPTION_BEARING_TYPES = new Set<string>(OPTION_BEARING_QUESTION_TYPES);
