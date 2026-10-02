import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { formatAnswerValue } from "@/domains/responses/format";

/**
 * Slack (PRD P2.14) through an incoming webhook: the creator makes the
 * webhook in Slack (that's where the channel is chosen) and pastes its
 * URL. Deliveries use the same queue, retries and backoff as webhooks;
 * only the message is different. File answers never carry a link:
 * uploads are private, so the message points to the response instead.
 */

export function isSlackWebhookUrl(url: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url);
}

/** Slack's mrkdwn treats &, < and > specially. */
function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MAX_FIELDS = 10;
const MAX_VALUE = 300;

export function buildSlackMessage(input: {
  formTitle: string;
  schema: FormSchemaV1;
  answers: Record<string, unknown>;
  /** Which questions to include; empty = the first ten answered. */
  questionIds: string[];
  responseUrl: string;
}) {
  const answerable = [...input.schema.questions]
    .sort((a, b) => a.order - b.order)
    .filter((q) => q.type !== "welcome_screen" && q.type !== "statement");
  const chosen = (
    input.questionIds.length
      ? answerable.filter((q) => input.questionIds.includes(q.id))
      : answerable.filter((q) => input.answers[q.id] !== undefined)
  ).slice(0, MAX_FIELDS);

  const lines = chosen.map((q) => {
    const raw = input.answers[q.id];
    const value =
      raw === undefined || raw === null || raw === ""
        ? "—"
        : q.type === "file_upload"
          ? "File uploaded (open the response to see it)"
          : formatAnswerValue(q, raw);
    const short = value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value;
    return `*${escape(q.label.trim() || "Untitled")}*\n${escape(short)}`;
  });

  const title = `New response to ${input.formTitle}`;
  return {
    text: title,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${escape(title)}*` } },
      ...(lines.length
        ? [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n\n") } }]
        : []),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open the response" },
            url: input.responseUrl,
          },
        ],
      },
    ],
  };
}
