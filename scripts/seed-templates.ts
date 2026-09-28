/**
 * Seeds the `templates` table with a starter library of ready-made
 * forms. Run with `npm run db:seed-templates` (requires local Supabase
 * running — see docs/testing.md). Idempotent: re-running replaces each
 * template's schema by title rather than duplicating rows, so this is
 * safe to run again after editing a template below.
 *
 * Every schema is assembled with the same domain helpers the builder
 * UI itself uses (createQuestion/createOption/createEnding) and then
 * run through the real parseFormSchema/validateSemantics pipeline
 * before being written — a template that fails validation here would
 * also fail to load in the builder, so this script is the check, not
 * just the seed.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/lib/supabase/database.types";
import { createQuestion, createOption, createEnding } from "../src/domains/forms/builder";
import { parseFormSchema, validateSemantics } from "../src/domains/forms/schema/validate";
import type { FormSchemaV1, QuestionV1, OptionV1 } from "../src/domains/forms/schema/v1";
import type { QuestionType } from "../src/domains/forms/schema/question-types";

type QuestionSpec = {
  type: QuestionType;
  label: string;
  description?: string;
  required?: boolean;
  options?: string[];
  buttonLabel?: string;
};

function buildQuestions(specs: QuestionSpec[]): QuestionV1[] {
  return specs.map((spec, index) => {
    const base = createQuestion(spec.type, index);
    const question: QuestionV1 = {
      ...base,
      label: spec.label,
      description: spec.description,
      required: spec.required ?? base.required,
    };

    if (spec.options) {
      const options: OptionV1[] = spec.options.map((label) => createOption(label));
      question.settings = { ...question.settings, options } as QuestionV1["settings"];
    }
    if (spec.buttonLabel) {
      question.settings = {
        ...question.settings,
        buttonLabel: spec.buttonLabel,
      } as QuestionV1["settings"];
    }

    return question;
  });
}

function buildSchema(
  title: string,
  description: string,
  specs: QuestionSpec[],
): FormSchemaV1 {
  const ending = createEnding("Thanks for your time!");
  return {
    schemaVersion: 1,
    meta: { title, description },
    theme: {
      primaryColor: "#0f172a",
      backgroundColor: "#ffffff",
      fontFamily: "inter",
      buttonStyle: "rounded",
    },
    endings: [{ ...ending, isDefault: true }],
    questions: buildQuestions([
      { type: "welcome_screen", label: title, description, buttonLabel: "Start" },
      ...specs,
    ]),
    logic: [],
  };
}

type TemplateDef = {
  title: string;
  category: string;
  description: string;
  schema: FormSchemaV1;
};

function t(
  category: string,
  title: string,
  description: string,
  specs: QuestionSpec[],
): TemplateDef {
  return { title, category, description, schema: buildSchema(title, description, specs) };
}

const templates: TemplateDef[] = [
  // --- Feedback --------------------------------------------------------
  t(
    "Feedback",
    "Customer Satisfaction Survey (CSAT)",
    "Measure how satisfied customers are after an interaction.",
    [
      {
        type: "rating",
        label: "How satisfied were you with your experience?",
        required: true,
      },
      {
        type: "single_select",
        label: "What did you like most?",
        options: ["Speed", "Support quality", "Ease of use", "Price", "Other"],
      },
      { type: "long_text", label: "Anything we could do better?" },
    ],
  ),
  t(
    "Feedback",
    "Net Promoter Score (NPS)",
    "The classic single-question loyalty metric, plus a follow-up.",
    [
      {
        type: "opinion_scale",
        label: "How likely are you to recommend us to a friend or colleague?",
        required: true,
      },
      { type: "long_text", label: "What's the main reason for your score?" },
    ],
  ),
  t(
    "Feedback",
    "Product Feedback",
    "Open-ended feedback on a specific product or feature.",
    [
      {
        type: "short_text",
        label: "Which product or feature is this about?",
        required: true,
      },
      { type: "rating", label: "How would you rate it overall?", required: true },
      { type: "long_text", label: "What's working well?" },
      { type: "long_text", label: "What's missing or frustrating?" },
    ],
  ),

  // --- Surveys -----------------------------------------------------------
  t(
    "Surveys",
    "Employee Engagement Survey",
    "A short, anonymous pulse check on team morale.",
    [
      { type: "opinion_scale", label: "I feel motivated by my work.", required: true },
      {
        type: "opinion_scale",
        label: "I have the tools and support I need.",
        required: true,
      },
      {
        type: "single_select",
        label: "How would you describe your workload?",
        options: ["Too light", "About right", "Too heavy"],
      },
      { type: "long_text", label: "What's one thing we could change?" },
    ],
  ),
  t("Surveys", "Post-Event Survey", "Gather feedback right after an event wraps up.", [
    { type: "rating", label: "How would you rate the event overall?", required: true },
    {
      type: "single_select",
      label: "Which part was most valuable?",
      options: ["Speakers", "Networking", "Content/workshops", "Venue/logistics"],
    },
    { type: "yes_no", label: "Would you attend again?" },
    { type: "long_text", label: "Any suggestions for next time?" },
  ]),
  t(
    "Surveys",
    "Market Research Survey",
    "Understand awareness and preferences in your target market.",
    [
      {
        type: "yes_no",
        label: "Have you heard of our company before today?",
        required: true,
      },
      {
        type: "multi_select",
        label: "Which of these factors matter most when choosing a provider?",
        options: ["Price", "Quality", "Brand reputation", "Customer support", "Speed"],
      },
      {
        type: "short_text",
        label: "What's your biggest challenge in this area right now?",
      },
    ],
  ),

  // --- Lead Generation -----------------------------------------------------
  t(
    "Lead Generation",
    "Contact Us Form",
    "A simple way for prospects to reach your team.",
    [
      { type: "short_text", label: "Full name", required: true },
      { type: "email", label: "Email address", required: true },
      { type: "phone", label: "Phone number" },
      { type: "long_text", label: "How can we help?", required: true },
    ],
  ),
  t(
    "Lead Generation",
    "Newsletter Signup",
    "Collect email addresses for a mailing list.",
    [
      { type: "email", label: "Email address", required: true },
      {
        type: "multi_select",
        label: "What are you interested in hearing about?",
        options: ["Product updates", "Industry news", "Events", "Tips & tutorials"],
      },
    ],
  ),
  t(
    "Lead Generation",
    "Demo Request",
    "Qualify inbound leads asking for a product demo.",
    [
      { type: "short_text", label: "Full name", required: true },
      { type: "email", label: "Work email", required: true },
      { type: "short_text", label: "Company name", required: true },
      {
        type: "single_select",
        label: "Company size",
        options: ["1-10", "11-50", "51-200", "201-1000", "1000+"],
      },
      { type: "long_text", label: "What are you hoping to solve?" },
    ],
  ),

  // --- HR & Recruiting -------------------------------------------------------
  t(
    "HR & Recruiting",
    "Job Application",
    "A general-purpose application form for open roles.",
    [
      { type: "short_text", label: "Full name", required: true },
      { type: "email", label: "Email address", required: true },
      { type: "phone", label: "Phone number", required: true },
      { type: "url", label: "LinkedIn or portfolio URL" },
      { type: "file_upload", label: "Upload your resume", required: true },
      { type: "long_text", label: "Why are you interested in this role?" },
    ],
  ),
  t(
    "HR & Recruiting",
    "Candidate Screening Questionnaire",
    "A quick pre-interview screen for applicants.",
    [
      { type: "short_text", label: "Full name", required: true },
      {
        type: "single_select",
        label: "Are you legally authorized to work in this location?",
        required: true,
        options: ["Yes", "No"],
      },
      { type: "number", label: "Years of relevant experience", required: true },
      { type: "date", label: "Earliest start date" },
      { type: "long_text", label: "What draws you to this role?" },
    ],
  ),
  t(
    "HR & Recruiting",
    "Employee Exit Interview",
    "Understand why an employee is leaving and how to improve.",
    [
      { type: "short_text", label: "What was your role?", required: true },
      {
        type: "single_select",
        label: "What's the primary reason you're leaving?",
        options: [
          "New opportunity",
          "Compensation",
          "Management",
          "Work-life balance",
          "Relocation",
          "Other",
        ],
      },
      {
        type: "opinion_scale",
        label: "How would you rate your overall experience here?",
      },
      { type: "long_text", label: "What could we have done differently?" },
    ],
  ),

  // --- Events --------------------------------------------------------------
  t("Events", "Event Registration", "Collect attendee details ahead of an event.", [
    { type: "short_text", label: "Full name", required: true },
    { type: "email", label: "Email address", required: true },
    { type: "short_text", label: "Company or organization" },
    {
      type: "single_select",
      label: "Which session are you most interested in?",
      options: ["Morning track", "Afternoon track", "Both"],
    },
    { type: "long_text", label: "Dietary restrictions or accessibility needs" },
  ]),
  t("Events", "RSVP Form", "A lightweight yes/no RSVP with a headcount.", [
    { type: "short_text", label: "Full name", required: true },
    { type: "yes_no", label: "Will you be attending?", required: true },
    { type: "number", label: "Number of guests (including yourself)" },
    { type: "long_text", label: "Anything else we should know?" },
  ]),
  t("Events", "Webinar Signup", "Register attendees for an upcoming webinar.", [
    { type: "short_text", label: "Full name", required: true },
    { type: "email", label: "Email address", required: true },
    { type: "short_text", label: "Job title" },
    {
      type: "long_text",
      label: "What questions do you want answered during the session?",
    },
  ]),

  // --- Education ------------------------------------------------------------
  t("Education", "Course Feedback", "End-of-course feedback from students.", [
    { type: "short_text", label: "Course name", required: true },
    { type: "rating", label: "How would you rate this course overall?", required: true },
    { type: "opinion_scale", label: "How clear was the instructor?" },
    { type: "long_text", label: "What was most valuable?" },
    { type: "long_text", label: "What would you improve?" },
  ]),
  t("Education", "Student Enrollment", "Collect student details for course enrollment.", [
    { type: "short_text", label: "Full name", required: true },
    { type: "email", label: "Email address", required: true },
    { type: "date", label: "Date of birth" },
    {
      type: "single_select",
      label: "Preferred schedule",
      options: ["Weekday mornings", "Weekday evenings", "Weekends"],
    },
  ]),
  t(
    "Education",
    "Quiz: Knowledge Check",
    "A short knowledge check with a few multiple-choice questions.",
    [
      {
        type: "single_select",
        label: "Which of these is a primary color?",
        required: true,
        options: ["Green", "Red", "Purple", "Orange"],
      },
      {
        type: "single_select",
        label: "What is 9 x 8?",
        required: true,
        options: ["62", "72", "81", "64"],
      },
      { type: "short_text", label: "Any feedback on the quiz format?" },
    ],
  ),

  // --- E-commerce ----------------------------------------------------------
  t("E-commerce", "Order Feedback", "Post-purchase feedback on a recent order.", [
    { type: "short_text", label: "Order number" },
    { type: "rating", label: "How satisfied were you with your order?", required: true },
    {
      type: "single_select",
      label: "How was the delivery experience?",
      options: ["Excellent", "Good", "Fair", "Poor"],
    },
    { type: "long_text", label: "Anything we should improve?" },
  ]),
  t(
    "E-commerce",
    "Product Return Request",
    "Collect the details needed to process a return.",
    [
      { type: "short_text", label: "Order number", required: true },
      { type: "email", label: "Email used for the order", required: true },
      {
        type: "single_select",
        label: "Reason for return",
        required: true,
        options: [
          "Wrong item",
          "Damaged/defective",
          "No longer needed",
          "Doesn't fit",
          "Other",
        ],
      },
      { type: "long_text", label: "Additional details" },
    ],
  ),
  t(
    "E-commerce",
    "Customer Testimonial Request",
    "Ask happy customers for a quote you can use in marketing.",
    [
      { type: "short_text", label: "Full name", required: true },
      { type: "short_text", label: "Company (optional)" },
      {
        type: "long_text",
        label: "What results have you seen since using our product?",
        required: true,
      },
      { type: "yes_no", label: "Can we use your name and quote publicly?" },
    ],
  ),

  // --- Marketing -------------------------------------------------------------
  t(
    "Marketing",
    "Content Interest Survey",
    "Find out what topics your audience wants more of.",
    [
      {
        type: "multi_select",
        label: "Which topics are you most interested in?",
        required: true,
        options: [
          "How-to guides",
          "Case studies",
          "Industry trends",
          "Product tutorials",
        ],
      },
      {
        type: "single_select",
        label: "How do you prefer to consume content?",
        options: ["Articles", "Video", "Podcasts", "Live webinars"],
      },
      { type: "email", label: "Email address (optional, to send you more)" },
    ],
  ),
  t(
    "Marketing",
    "Brand Awareness Survey",
    "Gauge how well-known your brand is with an audience.",
    [
      { type: "yes_no", label: "Have you heard of our brand before?", required: true },
      {
        type: "single_select",
        label: "Where did you first hear about us?",
        options: [
          "Social media",
          "Search engine",
          "Word of mouth",
          "Advertisement",
          "Other",
        ],
      },
      {
        type: "opinion_scale",
        label: "How would you rate your overall impression of our brand?",
      },
    ],
  ),
  t(
    "Marketing",
    "Case Study Interview Request",
    "Invite a customer to be featured in a case study.",
    [
      { type: "short_text", label: "Full name", required: true },
      { type: "short_text", label: "Company", required: true },
      { type: "email", label: "Email address", required: true },
      {
        type: "single_select",
        label: "Would you be open to a 20-30 minute interview?",
        required: true,
        options: ["Yes", "No", "Maybe — send more details"],
      },
    ],
  ),
];

for (const template of templates) {
  const parsed = parseFormSchema(template.schema);
  validateSemantics(parsed);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (check .env.local)",
    );
  }
  const admin = createClient<Database>(url, key, { auth: { persistSession: false } });

  const categories = [...new Set(templates.map((tpl) => tpl.category))];
  let sortOrder = 0;
  for (const category of categories) {
    for (const template of templates.filter((tpl) => tpl.category === category)) {
      const { data: existing } = await admin
        .from("templates")
        .select("id")
        .eq("title", template.title)
        .maybeSingle();

      const row = {
        title: template.title,
        category: template.category,
        description: template.description,
        schema: template.schema as unknown as Json,
        sort_order: sortOrder,
      };

      if (existing) {
        const { error } = await admin.from("templates").update(row).eq("id", existing.id);
        if (error) throw error;
        console.log(`updated: ${template.title}`);
      } else {
        const { error } = await admin.from("templates").insert(row);
        if (error) throw error;
        console.log(`inserted: ${template.title}`);
      }
      sortOrder += 1;
    }
  }

  console.log(
    `\nSeeded ${templates.length} templates across ${categories.length} categories.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
