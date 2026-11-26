import { z } from "zod";

/**
 * Custom email templates (developer spec item 2; Starter and up): the
 * fields and body blocks a creator edits. The body is structured blocks,
 * never raw HTML, rendered by render.ts into table-based HTML and plain
 * text. Text blocks take a small markup: **bold**, *italic*,
 * [label](https://link) and lines starting "- " for lists.
 */

export const TEMPLATE_KINDS = [
  "confirmation",
  "owner_notification",
  "rule",
  "booking_confirmation",
  "booking_reminder",
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const KIND_LABEL: Record<TemplateKind, string> = {
  confirmation: "Respondent confirmation",
  owner_notification: "Owner notification",
  rule: "Notification rule email",
  booking_confirmation: "Booking confirmation",
  booking_reminder: "Booking reminder",
};

/** Merge tags, e.g. {{answer:q1}} or {{answer:q1 | "there"}}. */
export const MERGE_TAG =
  /\{\{\s*(answer:[A-Za-z0-9_-]{1,64}|hidden:[A-Za-z0-9_-]{1,64}|form\.title|response\.id|response\.submitted_at|score|ending|respondent\.email|booking\.type|booking\.time)\s*(?:\|\s*"([^"{}\r\n]{0,100})"\s*)?\}\}/g;
const ANY_TAG = /\{\{[^}]*\}\}/g;

/** The {{…}} in a text that aren't merge tags this app knows. */
export function unknownTags(text: string): string[] {
  const all = text.match(ANY_TAG) ?? [];
  return all.filter((t) => !new RegExp(MERGE_TAG.source).test(t));
}

const safeUrl = z
  .string()
  .trim()
  .max(2000)
  .regex(
    /^(https?:\/\/|mailto:)[^\s"'<>]+$/,
    "Links must start with https://, http:// or mailto:",
  )
  .refine((u) => !/\{\{/.test(u), "Links can't contain merge tags.");

const TextBlock = z.object({
  type: z.literal("text"),
  text: z.string().max(4000),
});
const HeadingBlock = z.object({
  type: z.literal("heading"),
  text: z.string().min(1).max(200),
});
const ImageBlock = z.object({
  type: z.literal("image"),
  url: z.string().url().max(500),
  alt: z.string().max(200).default(""),
});
const ButtonBlock = z.object({
  type: z.literal("button"),
  label: z.string().trim().min(1).max(60),
  url: safeUrl,
});
const DividerBlock = z.object({ type: z.literal("divider") });
const AnswersBlock = z.object({ type: z.literal("answers") });
const SpacerBlock = z.object({
  type: z.literal("spacer"),
  size: z.number().int().min(8).max(64).default(24),
});

export const TemplateBlock = z.discriminatedUnion("type", [
  TextBlock,
  HeadingBlock,
  ImageBlock,
  ButtonBlock,
  DividerBlock,
  AnswersBlock,
  SpacerBlock,
]);
export type TemplateBlock = z.infer<typeof TemplateBlock>;

export const ReplyTo = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("owner") }),
  z.object({ mode: z.literal("fixed"), address: z.string().trim().email().max(254) }),
  z.object({
    mode: z.literal("answer"),
    questionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  }),
]);
export type ReplyTo = z.infer<typeof ReplyTo>;

export const EmailTemplate = z
  .object({
    subject: z.string().trim().min(1).max(150),
    preheader: z.string().trim().max(120).optional(),
    senderName: z
      .string()
      .trim()
      .max(60)
      .regex(/^[^<>"@,;\r\n]*$/, "The sender name can't use < > \" @ , ;")
      .optional(),
    replyTo: ReplyTo.default({ mode: "owner" }),
    blocks: z.array(TemplateBlock).min(1).max(60),
    /** Overrides of the form theme's logo and colour. */
    brand: z
      .object({
        logoUrl: z.string().url().max(500).optional(),
        accentColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .default({}),
    /** Rule emails: attach the response's PDF, where the rule has one. */
    attachPdf: z.boolean().optional(),
  })
  .superRefine((t, ctx) => {
    if (JSON.stringify(t).length > 100_000) {
      ctx.addIssue({ code: "custom", message: "Keep a template under 100 KB." });
    }
    if (t.blocks.filter((b) => b.type === "image").length > 10) {
      ctx.addIssue({ code: "custom", message: "Use up to 10 images." });
    }
    const texts = [
      t.subject,
      t.preheader ?? "",
      ...t.blocks.flatMap((b) =>
        b.type === "text" || b.type === "heading"
          ? [b.text]
          : b.type === "button"
            ? [b.label]
            : [],
      ),
    ];
    const bad = texts.flatMap(unknownTags);
    if (bad.length) {
      ctx.addIssue({
        code: "custom",
        message: `Unknown merge tag ${bad[0]}. Pick one from the list.`,
      });
    }
  });
export type EmailTemplate = z.infer<typeof EmailTemplate>;

/** Each kind's starting template (also what "Reset to default" shows
 * until saved). */
export function defaultTemplate(kind: TemplateKind): EmailTemplate {
  switch (kind) {
    case "confirmation":
      return {
        subject: "Thanks for your response to {{form.title}}",
        preheader: "We've got your answers.",
        replyTo: { mode: "owner" },
        brand: {},
        blocks: [
          { type: "heading", text: 'Thanks, {{answer:name | "there"}}!' },
          { type: "text", text: "We've got your answers to **{{form.title}}**." },
        ],
      };
    case "owner_notification":
      return {
        subject: "New response: {{form.title}}",
        replyTo: { mode: "owner" },
        brand: {},
        blocks: [
          { type: "heading", text: "New response received" },
          { type: "text", text: "Someone just finished **{{form.title}}**." },
        ],
      };
    case "rule":
      return {
        subject: "{{form.title}}: a response matched",
        replyTo: { mode: "owner" },
        brand: {},
        blocks: [
          { type: "heading", text: "A new response matched this notification" },
          { type: "answers" },
        ],
      };
    case "booking_confirmation":
      return {
        subject: "Booked: {{booking.type}}",
        replyTo: { mode: "owner" },
        brand: {},
        blocks: [
          { type: "heading", text: "You're booked" },
          { type: "text", text: "**{{booking.type}}** on {{booking.time}}." },
        ],
      };
    case "booking_reminder":
      return {
        subject: "Reminder: {{booking.type}}",
        replyTo: { mode: "owner" },
        brand: {},
        blocks: [
          { type: "heading", text: "See you soon" },
          { type: "text", text: "**{{booking.type}}** is on {{booking.time}}." },
        ],
      };
  }
}

/** The merge tags the picker offers for a kind (answers listed apart). */
export function mergeTagsFor(kind: TemplateKind): { tag: string; label: string }[] {
  const common = [
    { tag: "{{form.title}}", label: "Form title" },
    { tag: "{{response.id}}", label: "Response ID" },
    { tag: "{{response.submitted_at}}", label: "Submitted at" },
    { tag: "{{respondent.email}}", label: "Respondent's email" },
    { tag: "{{score}}", label: "Score" },
    { tag: "{{ending}}", label: "Ending reached" },
  ];
  return kind === "booking_confirmation" || kind === "booking_reminder"
    ? [
        { tag: "{{booking.type}}", label: "Booking type" },
        { tag: "{{booking.time}}", label: "Booking time" },
        ...common,
      ]
    : common;
}
