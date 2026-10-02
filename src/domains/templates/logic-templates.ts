import type { z } from "zod";
import type { Condition, Expr, Value } from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

/**
 * Starter forms that show off the logic engine (Phase 33). Each one is
 * plain schema — variables, rules, show conditions, scores — the same
 * thing a creator builds in the Logic view; nothing here is special-case
 * code. Seeded into `templates` by scripts/seed-templates.ts and walked
 * end to end in tests/unit/logic-templates.test.ts.
 */

type FormInput = z.input<typeof FormSchemaV1>;

export type LogicTemplate = {
  title: string;
  category: string;
  description: string;
  schema: FormInput;
};

const lit = (value: Value): Expr => ({ type: "literal", value });
const ans = (questionId: string, field?: string): Expr => ({
  type: "answer",
  questionId,
  field,
});
const v = (variableId: string): Expr => ({ type: "variable", variableId });
const cmp = (
  left: Expr,
  op: Extract<Condition, { type: "compare" }>["op"],
  right?: Expr,
  right2?: Expr,
): Condition => ({ type: "compare", left, op, right, right2 });
const theme = {
  primaryColor: "#1f1f1f",
  backgroundColor: "#ffffff",
  fontFamily: "inter" as const,
  buttonStyle: "rounded" as const,
};
const welcome = (title: string, description: string) => ({
  id: "q_welcome",
  type: "welcome_screen" as const,
  order: 0,
  label: title,
  description,
  settings: { buttonLabel: "Start" },
});
const CATEGORY = "Quizzes & logic";

const knowledgeQuiz: LogicTemplate = {
  title: "Knowledge quiz",
  category: CATEGORY,
  description: "Questions with right answers, a score, a percentage and a grade.",
  schema: {
    schemaVersion: 1,
    meta: {
      title: "Knowledge quiz",
      description: "Three quick questions. Let's see how you do.",
    },
    theme,
    variables: [
      { id: "v_score", name: "score", type: "number" },
      { id: "v_percent", name: "percent", type: "number" },
      { id: "v_grade", name: "grade", type: "string", initial: "Keep practising" },
    ],
    endings: [
      {
        id: "e_result",
        title: "You scored {{score}} out of 3 ({{percent}}%)",
        description: "Grade: {{grade}}.",
        isDefault: true,
      },
    ],
    questions: [
      welcome("Knowledge quiz", "Three quick questions. Let's see how you do."),
      {
        id: "q_capital",
        type: "single_select",
        order: 1,
        label: "What's the capital of Australia?",
        required: true,
        settings: {
          options: [
            { id: "o_sydney", label: "Sydney" },
            {
              id: "o_canberra",
              label: "Canberra",
              correct: true,
              scores: [{ variableId: "v_score", points: 1 }],
            },
            { id: "o_melbourne", label: "Melbourne" },
          ],
        },
      },
      {
        id: "q_planet",
        type: "single_select",
        order: 2,
        label: "Which planet is closest to the Sun?",
        required: true,
        settings: {
          options: [
            {
              id: "o_mercury",
              label: "Mercury",
              correct: true,
              scores: [{ variableId: "v_score", points: 1 }],
            },
            { id: "o_venus", label: "Venus" },
            { id: "o_mars", label: "Mars" },
          ],
        },
      },
      {
        id: "q_primes",
        type: "multi_select",
        order: 3,
        label: "Which of these are prime numbers?",
        description: "Choose every one that is.",
        required: true,
        settings: {
          options: [
            {
              id: "o_2",
              label: "2",
              correct: true,
              scores: [{ variableId: "v_score", points: 0.5 }],
            },
            { id: "o_9", label: "9", scores: [{ variableId: "v_score", points: -0.5 }] },
            {
              id: "o_11",
              label: "11",
              correct: true,
              scores: [{ variableId: "v_score", points: 0.5 }],
            },
          ],
        },
      },
    ],
    logic: [],
    rules: [
      {
        id: "r_percent",
        name: "Percentage",
        on: { event: "form_completed" },
        then: [
          {
            type: "set_variable",
            variableId: "v_percent",
            op: "set",
            value: {
              type: "call",
              fn: "ROUND",
              args: [{ type: "call", fn: "PERCENTAGE", args: [v("v_score"), lit(3)] }],
            },
          },
        ],
      },
      {
        id: "r_good",
        name: "Grade: good",
        on: { event: "form_completed" },
        when: cmp(v("v_score"), "gte", lit(2)),
        then: [
          { type: "set_variable", variableId: "v_grade", op: "set", value: lit("Good") },
        ],
      },
      {
        id: "r_excellent",
        name: "Grade: excellent",
        on: { event: "form_completed" },
        when: cmp(v("v_score"), "gte", lit(3)),
        then: [
          {
            type: "set_variable",
            variableId: "v_grade",
            op: "set",
            value: lit("Excellent"),
          },
        ],
      },
    ],
  },
};

const outcomeQuiz: LogicTemplate = {
  title: "Which work style are you?",
  category: CATEGORY,
  description:
    "A personality quiz: answers add to three scores and the highest picks the result.",
  schema: {
    schemaVersion: 1,
    meta: { title: "Which work style are you?" },
    theme,
    variables: [
      { id: "v_builder", name: "builder", type: "number" },
      { id: "v_creative", name: "creative", type: "number" },
      { id: "v_strategist", name: "strategist", type: "number" },
    ],
    endings: [
      {
        id: "e_builder",
        title: "You're a Builder",
        description: "You turn ideas into working things.",
        isDefault: true,
      },
      {
        id: "e_creative",
        title: "You're a Creative",
        description: "You see what others miss.",
      },
      {
        id: "e_strategist",
        title: "You're a Strategist",
        description: "You know where things should go next.",
      },
    ],
    questions: [
      welcome(
        "Which work style are you?",
        "Five seconds per question. Go with your gut.",
      ),
      {
        id: "q_weekend",
        type: "single_select",
        order: 1,
        label: "A free Saturday. You…",
        required: true,
        settings: {
          options: [
            {
              id: "o_fix",
              label: "Fix something that's been bugging you",
              scores: [{ variableId: "v_builder", points: 2 }],
            },
            {
              id: "o_make",
              label: "Make something just for fun",
              scores: [{ variableId: "v_creative", points: 2 }],
            },
            {
              id: "o_plan",
              label: "Plan the next few months",
              scores: [{ variableId: "v_strategist", points: 2 }],
            },
          ],
        },
      },
      {
        id: "q_meeting",
        type: "single_select",
        order: 2,
        label: "In a meeting you're most likely to…",
        required: true,
        settings: {
          options: [
            {
              id: "o_ship",
              label: "Ask what we can ship this week",
              scores: [{ variableId: "v_builder", points: 2 }],
            },
            {
              id: "o_sketch",
              label: "Sketch a wild idea on the whiteboard",
              scores: [{ variableId: "v_creative", points: 2 }],
            },
            {
              id: "o_why",
              label: "Ask why we're doing this at all",
              scores: [{ variableId: "v_strategist", points: 2 }],
            },
          ],
        },
      },
      {
        id: "q_praise",
        type: "single_select",
        order: 3,
        label: "The compliment you like best:",
        required: true,
        settings: {
          options: [
            {
              id: "o_reliable",
              label: "“You always deliver.”",
              scores: [{ variableId: "v_builder", points: 1 }],
            },
            {
              id: "o_original",
              label: "“I'd never have thought of that.”",
              scores: [{ variableId: "v_creative", points: 1 }],
            },
            {
              id: "o_wise",
              label: "“You saw that coming.”",
              scores: [{ variableId: "v_strategist", points: 1 }],
            },
          ],
        },
      },
    ],
    logic: [],
    rules: [
      {
        id: "r_outcome",
        name: "Show the top style",
        on: { event: "form_completed" },
        then: [
          {
            type: "go_to_highest",
            candidates: [
              { variableId: "v_builder", endingId: "e_builder" },
              { variableId: "v_creative", endingId: "e_creative" },
              { variableId: "v_strategist", endingId: "e_strategist" },
            ],
          },
        ],
      },
    ],
  },
};

const leadQualification: LogicTemplate = {
  title: "B2B lead qualification",
  category: CATEGORY,
  description:
    "Scores company size, budget and timing, then routes qualified leads to a booking ending.",
  schema: {
    schemaVersion: 1,
    meta: { title: "B2B lead qualification" },
    theme,
    hiddenFields: [{ name: "source", default: "website" }],
    variables: [
      { id: "v_lead", name: "lead_score", type: "number" },
      { id: "v_segment", name: "segment", type: "string", initial: "smb" },
      { id: "v_qualified", name: "qualified", type: "boolean" },
      { id: "v_name", name: "first_name", type: "string", initial: "there" },
    ],
    endings: [
      {
        id: "e_thanks",
        title: "Thanks! We'll email you some resources.",
        isDefault: true,
      },
      {
        id: "e_book",
        title: "Let's talk, {{first_name}}",
        description:
          "You're a great fit (score {{lead_score}}). Pick a time on the next page.",
        buttonLabel: "Book a call",
        redirectUrl: "https://example.com/book?segment={{segment}}&source={{source}}",
      },
    ],
    questions: [
      welcome(
        "Tell us about your team",
        "Two minutes, and we'll point you to the right next step.",
      ),
      {
        id: "q_size",
        type: "single_select",
        order: 1,
        label: "How many people work at your company?",
        required: true,
        settings: {
          options: [
            {
              id: "o_1_10",
              label: "1–10",
              scores: [{ variableId: "v_lead", points: 5 }],
            },
            {
              id: "o_11_200",
              label: "11–200",
              scores: [{ variableId: "v_lead", points: 20 }],
            },
            {
              id: "o_200",
              label: "200+",
              scores: [{ variableId: "v_lead", points: 35 }],
            },
          ],
        },
      },
      {
        id: "q_budget",
        type: "number",
        order: 2,
        label: "What's your monthly budget (USD)?",
        required: true,
        settings: { min: 0 },
      },
      {
        id: "q_timeline",
        type: "single_select",
        order: 3,
        label: "When do you want to start?",
        required: true,
        settings: {
          options: [
            {
              id: "o_now",
              label: "This month",
              scores: [{ variableId: "v_lead", points: 25 }],
            },
            {
              id: "o_quarter",
              label: "This quarter",
              scores: [{ variableId: "v_lead", points: 15 }],
            },
            { id: "o_later", label: "Just exploring" },
          ],
        },
      },
      {
        id: "q_security",
        type: "yes_no",
        order: 4,
        label: "Will your security team need to review us?",
        settings: {},
        visibleIf: cmp(ans("q_size"), "eq", lit("o_200")),
      },
      {
        id: "q_contact",
        type: "contact_info",
        order: 5,
        label: "Where should we reach you?",
        required: true,
        settings: {
          fields: ["name", "email", "company"],
          requiredFields: ["name", "email"],
        },
      },
    ],
    logic: [],
    rules: [
      {
        id: "r_name",
        name: "Remember their name",
        on: { event: "question_answered", questionId: "q_contact" },
        when: cmp(ans("q_contact", "name"), "is_not_empty"),
        then: [
          {
            type: "set_variable",
            variableId: "v_name",
            op: "set",
            value: ans("q_contact", "name"),
          },
        ],
      },
      {
        id: "r_budget",
        name: "Budget points",
        on: { event: "question_answered", questionId: "q_budget" },
        then: [
          {
            type: "set_variable",
            variableId: "v_lead",
            op: "add",
            value: {
              type: "call",
              fn: "MIN",
              args: [
                lit(40),
                {
                  type: "call",
                  fn: "ROUND",
                  args: [
                    { type: "binary", op: "/", left: ans("q_budget"), right: lit(250) },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        id: "r_enterprise",
        name: "Enterprise segment",
        on: { event: "form_completed" },
        when: cmp(ans("q_size"), "eq", lit("o_200")),
        then: [
          {
            type: "set_variable",
            variableId: "v_segment",
            op: "set",
            value: lit("enterprise"),
          },
        ],
      },
      {
        id: "r_qualified",
        name: "Qualified → book a call",
        on: { event: "form_completed" },
        when: cmp(v("v_lead"), "gte", lit(60)),
        then: [
          {
            type: "set_variable",
            variableId: "v_qualified",
            op: "set",
            value: lit(true),
          },
          { type: "jump_to_ending", endingId: "e_book" },
        ],
      },
    ],
  },
};

const priceCalculator: LogicTemplate = {
  title: "Price estimate",
  category: CATEGORY,
  description:
    "A calculator: plan, seats, add-ons and a coupon add up to a subtotal, discount and total.",
  schema: {
    schemaVersion: 1,
    meta: { title: "Price estimate" },
    theme,
    variables: [
      { id: "v_seat", name: "seat_price", type: "number", initial: 10 },
      { id: "v_subtotal", name: "subtotal", type: "number" },
      { id: "v_discount", name: "discount", type: "number" },
      { id: "v_total", name: "total", type: "number" },
    ],
    endings: [
      {
        id: "e_quote",
        title: "Your estimate: ${{total}} a month",
        description: "Subtotal ${{subtotal}}, discount ${{discount}}.",
        isDefault: true,
      },
    ],
    questions: [
      welcome("Price estimate", "Answer three questions to see your monthly price."),
      {
        id: "q_plan",
        type: "single_select",
        order: 1,
        label: "Which plan?",
        required: true,
        settings: {
          options: [
            { id: "o_basic", label: "Basic ($10 a seat)" },
            { id: "o_pro", label: "Pro ($25 a seat)" },
          ],
        },
      },
      {
        id: "q_seats",
        type: "number",
        order: 2,
        label: "How many seats?",
        required: true,
        settings: { min: 1, max: 1000, decimals: 0 },
      },
      {
        id: "q_support",
        type: "yes_no",
        order: 3,
        label: "Add priority support (+$50)?",
        settings: {},
      },
      {
        id: "q_coupon",
        type: "short_text",
        order: 4,
        label: "Coupon code (optional)",
        settings: { placeholder: "e.g. SAVE10" },
      },
    ],
    logic: [],
    rules: [
      {
        id: "r_pro",
        name: "Pro seat price",
        on: { event: "question_answered", questionId: "q_plan" },
        when: cmp(ans("q_plan"), "eq", lit("o_pro")),
        then: [{ type: "set_variable", variableId: "v_seat", op: "set", value: lit(25) }],
      },
      {
        id: "r_subtotal",
        name: "Subtotal",
        on: { event: "form_completed" },
        then: [
          {
            type: "set_variable",
            variableId: "v_subtotal",
            op: "set",
            value: { type: "binary", op: "*", left: v("v_seat"), right: ans("q_seats") },
          },
        ],
      },
      {
        id: "r_support",
        name: "Priority support",
        on: { event: "form_completed" },
        when: cmp(ans("q_support"), "is_true"),
        then: [
          { type: "set_variable", variableId: "v_subtotal", op: "add", value: lit(50) },
        ],
      },
      {
        id: "r_coupon",
        name: "SAVE10 coupon",
        on: { event: "form_completed" },
        when: cmp(ans("q_coupon"), "eq", lit("SAVE10")),
        then: [
          {
            type: "set_variable",
            variableId: "v_discount",
            op: "set",
            value: {
              type: "call",
              fn: "ROUND",
              args: [
                { type: "binary", op: "*", left: v("v_subtotal"), right: lit(0.1) },
                lit(2),
              ],
            },
          },
        ],
      },
      {
        id: "r_total",
        name: "Total",
        on: { event: "form_completed" },
        then: [
          {
            type: "set_variable",
            variableId: "v_total",
            op: "set",
            value: {
              type: "binary",
              op: "-",
              left: v("v_subtotal"),
              right: v("v_discount"),
            },
          },
        ],
      },
    ],
  },
};

const eligibility: LogicTemplate = {
  title: "Scholarship eligibility",
  category: CATEGORY,
  description:
    "Checks age, country, study and income, and explains which requirement wasn't met.",
  schema: {
    schemaVersion: 1,
    meta: { title: "Scholarship eligibility" },
    theme,
    variables: [
      { id: "v_eligible", name: "eligible", type: "boolean", initial: true },
      { id: "v_failed", name: "failed", type: "list" },
    ],
    endings: [
      {
        id: "e_yes",
        title: "You're eligible!",
        description: "We'll send the application link by email.",
        isDefault: true,
      },
      {
        id: "e_no",
        title: "Not eligible this time",
        description: "Missing: {{failed}}.",
      },
    ],
    questions: [
      welcome("Scholarship eligibility", "Four questions to see if you can apply."),
      {
        id: "q_dob",
        type: "date",
        order: 1,
        label: "Your date of birth",
        required: true,
        settings: {},
      },
      {
        id: "q_country",
        type: "dropdown",
        order: 2,
        label: "Where do you live?",
        required: true,
        settings: {
          options: [
            { id: "o_in", label: "India" },
            { id: "o_uk", label: "United Kingdom" },
            { id: "o_other", label: "Somewhere else" },
          ],
        },
      },
      {
        id: "q_student",
        type: "yes_no",
        order: 3,
        label: "Are you enrolled as a student?",
        required: true,
        settings: {},
      },
      {
        id: "q_student_id",
        type: "short_text",
        order: 4,
        label: "Your student ID",
        required: true,
        settings: {},
        visibleIf: cmp(ans("q_student"), "is_true"),
      },
      {
        id: "q_income",
        type: "number",
        order: 5,
        label: "Household income per year (₹)",
        required: true,
        settings: { min: 0 },
      },
    ],
    logic: [],
    rules: [
      {
        id: "r_age",
        name: "Age 18+",
        on: { event: "form_completed" },
        when: cmp({ type: "call", fn: "AGE", args: [ans("q_dob")] }, "lt", lit(18)),
        then: [
          {
            type: "set_variable",
            variableId: "v_eligible",
            op: "set",
            value: lit(false),
          },
          {
            type: "set_variable",
            variableId: "v_failed",
            op: "append",
            value: lit("age 18 or over"),
          },
        ],
      },
      {
        id: "r_country",
        name: "Lives in India or the UK",
        on: { event: "form_completed" },
        when: cmp(ans("q_country"), "none_of", lit(["o_in", "o_uk"])),
        then: [
          {
            type: "set_variable",
            variableId: "v_eligible",
            op: "set",
            value: lit(false),
          },
          {
            type: "set_variable",
            variableId: "v_failed",
            op: "append",
            value: lit("living in India or the UK"),
          },
        ],
      },
      {
        id: "r_student",
        name: "Enrolled student",
        on: { event: "form_completed" },
        when: cmp(ans("q_student"), "is_false"),
        then: [
          {
            type: "set_variable",
            variableId: "v_eligible",
            op: "set",
            value: lit(false),
          },
          {
            type: "set_variable",
            variableId: "v_failed",
            op: "append",
            value: lit("being a student"),
          },
        ],
      },
      {
        id: "r_income",
        name: "Income under ₹5,00,000",
        on: { event: "form_completed" },
        when: cmp(ans("q_income"), "gte", lit(500000)),
        then: [
          {
            type: "set_variable",
            variableId: "v_eligible",
            op: "set",
            value: lit(false),
          },
          {
            type: "set_variable",
            variableId: "v_failed",
            op: "append",
            value: lit("household income under ₹5,00,000"),
          },
        ],
      },
      {
        id: "r_result",
        name: "Not eligible ending",
        on: { event: "form_completed" },
        when: cmp(v("v_eligible"), "is_false"),
        then: [{ type: "jump_to_ending", endingId: "e_no" }],
      },
    ],
  },
};

export const LOGIC_TEMPLATES: LogicTemplate[] = [
  knowledgeQuiz,
  outcomeQuiz,
  leadQualification,
  priceCalculator,
  eligibility,
];
