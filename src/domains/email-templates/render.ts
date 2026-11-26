import { MERGE_TAG, type EmailTemplate } from "./schema";

/**
 * Renders a custom email template (developer spec item 2) for one send:
 * table-based HTML that works in Gmail, Outlook and Apple Mail, and a
 * plain-text version made from the same blocks.
 *
 * Safety: the creator's markup is applied first, with each merge tag held
 * as a placeholder; the respondent's values go in afterwards, escaped, so
 * an answer can never become markup or a link. The subject, sender name
 * and reply-to lose any line breaks after merging (no header injection).
 */

export type MergeContext = {
  formTitle: string;
  responseId?: string;
  submittedAt?: string;
  /** Answers formatted for reading, by question id. */
  answers: Record<string, string>;
  hidden: Record<string, string>;
  score?: string;
  ending?: string;
  respondentEmail?: string;
  booking?: { type: string; time: string };
  /** The "All answers" table. */
  answerLines: { label: string; value: string }[];
};

export type Rendered = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const oneLine = (s: string) => s.replace(/[\r\n\t\u2028\u2029]+/g, " ").trim();

function tagValue(tag: string, ctx: MergeContext): string {
  if (tag.startsWith("answer:")) return ctx.answers[tag.slice(7)] ?? "";
  if (tag.startsWith("hidden:")) return ctx.hidden[tag.slice(7)] ?? "";
  switch (tag) {
    case "form.title":
      return ctx.formTitle;
    case "response.id":
      return ctx.responseId ?? "";
    case "response.submitted_at":
      return ctx.submittedAt
        ? `${new Date(ctx.submittedAt).toISOString().replace("T", " ").slice(0, 16)} UTC`
        : "";
    case "score":
      return ctx.score ?? "";
    case "ending":
      return ctx.ending ?? "";
    case "respondent.email":
      return ctx.respondentEmail ?? "";
    case "booking.type":
      return ctx.booking?.type ?? "";
    case "booking.time":
      return ctx.booking?.time ?? "";
    default:
      return "";
  }
}

/** Text with merge tags filled in (plain text; the caller escapes). */
export function mergePlain(text: string, ctx: MergeContext): string {
  return text.replace(
    new RegExp(MERGE_TAG.source, "g"),
    (_m, tag: string, fallback?: string) => {
      const value = tagValue(tag, ctx).trim();
      return (value || fallback || "").slice(0, 2000);
    },
  );
}

/** Creator markup to HTML, with merge values escaped into place. */
function markupHtml(text: string, ctx: MergeContext, accent: string): string {
  const values: string[] = [];
  // Hold each merge tag as a placeholder the markup can't touch.
  const held = text.replace(new RegExp(MERGE_TAG.source, "g"), (m) => {
    values.push(mergePlain(m, ctx));
    return `\u0000${values.length - 1}\u0000`;
  });
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(
        /\[([^\]]{1,200})\]\(((?:https?:\/\/|mailto:)[^\s)"'<>\u0000]{1,2000})\)/g,
        (_m, label: string, url: string) =>
          `<a href="${url}" style="color:${accent};text-decoration:underline">${label}</a>`,
      );
  const lines = held.split(/\r?\n/);
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${para.map(inline).join("<br>")}</p>`,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      out.push(
        `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.55">${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`,
      );
      list = [];
    }
  };
  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^\s*-\s+/, ""));
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  // Merge values last, escaped: respondent text stays text.
  return out
    .join("")
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => esc(values[Number(i)] ?? ""));
}

function markupText(text: string, ctx: MergeContext): string {
  return mergePlain(text, ctx)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)");
}

export function renderTemplate(
  template: EmailTemplate,
  ctx: MergeContext,
  options: {
    /** The form's theme colour and logo, unless the template overrides. */
    accent: string;
    logoUrl?: string;
    /** Who's sending, for the required footer line. */
    ownerName: string;
    footerReason: string;
  },
): Rendered {
  const accent = template.brand.accentColor ?? options.accent;
  const logo = template.brand.logoUrl ?? options.logoUrl;
  const subject =
    oneLine(mergePlain(template.subject, ctx)).slice(0, 200) || ctx.formTitle;
  const preheader = oneLine(mergePlain(template.preheader ?? "", ctx)).slice(0, 150);
  const html: string[] = [];
  const text: string[] = [];
  for (const block of template.blocks) {
    switch (block.type) {
      case "heading": {
        const h = mergePlain(block.text, ctx);
        html.push(
          `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:700">${esc(h)}</h1>`,
        );
        text.push(h.toUpperCase(), "");
        break;
      }
      case "text":
        html.push(markupHtml(block.text, ctx, accent));
        text.push(markupText(block.text, ctx), "");
        break;
      case "image":
        html.push(
          `<p style="margin:0 0 14px"><img src="${esc(block.url)}" alt="${esc(block.alt)}" width="520" style="display:block;max-width:100%;height:auto;border:0;border-radius:8px"></p>`,
        );
        break;
      case "button": {
        const label = mergePlain(block.label, ctx);
        html.push(
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px"><tr><td bgcolor="${accent}" style="border-radius:8px"><a href="${esc(block.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:${onAccent(accent)};text-decoration:none;border-radius:8px">${esc(label)}</a></td></tr></table>`,
        );
        text.push(`${label}: ${block.url}`, "");
        break;
      }
      case "divider":
        html.push(`<hr style="border:0;border-top:1px solid #e6e1d8;margin:18px 0">`);
        text.push("—", "");
        break;
      case "spacer":
        html.push(
          `<div style="height:${block.size}px;line-height:${block.size}px">&nbsp;</div>`,
        );
        break;
      case "answers": {
        const rows = ctx.answerLines
          .filter((l) => l.value)
          .slice(0, 60)
          .map((l) => ({
            label: l.label.slice(0, 200),
            value: l.value.length > 500 ? `${l.value.slice(0, 499)}…` : l.value,
          }));
        html.push(
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border-collapse:collapse;font-size:14px">${rows
            .map(
              (r) =>
                `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid #eee8de;color:#6b5d50;vertical-align:top;width:40%">${esc(r.label)}</td><td style="padding:8px 0;border-bottom:1px solid #eee8de;vertical-align:top">${esc(r.value).replace(/\n/g, "<br>")}</td></tr>`,
            )
            .join("")}</table>`,
        );
        text.push(...rows.map((r) => `${r.label}: ${r.value}`), "");
        break;
      }
    }
  }
  const footer = `Sent by ${options.ownerName} via FormCraft. ${options.footerReason}`;
  text.push("—", footer);
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${esc(subject)}</title></head><body style="margin:0;padding:0;background:#f4f1ea">${
    preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}</div>`
      : ""
  }<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f1ea"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:12px"><tr><td style="padding:28px 32px 8px;font-family:Helvetica,Arial,sans-serif;color:#2b2118">${
    logo
      ? `<img src="${esc(logo)}" alt="${esc(options.ownerName)}" height="32" style="display:block;height:32px;width:auto;border:0;margin:0 0 20px">`
      : ""
  }${html.join("")}</td></tr><tr><td style="padding:8px 32px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#8a7d70">${esc(footer)}</td></tr></table></td></tr></table></body></html>`;
  return { subject, preheader, html: page, text: text.join("\n").trim() };
}

function onAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#ffffff" : "#141414";
}

/** The reply-to address: the template's choice, else the owner's. Any
 * address that isn't valid falls back to the owner's. */
export function replyToAddress(
  template: EmailTemplate,
  ctx: MergeContext,
  ownerEmail: string | null,
): string | null {
  const valid = (s: string | undefined) => {
    const v = oneLine(s ?? "");
    return v.length <= 254 && /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/.test(v)
      ? v
      : null;
  };
  if (template.replyTo.mode === "fixed")
    return valid(template.replyTo.address) ?? ownerEmail;
  if (template.replyTo.mode === "answer")
    return valid(ctx.answers[template.replyTo.questionId]) ?? ownerEmail;
  return ownerEmail;
}

/** Sample values for previews and test sends without a response. */
export function sampleContext(
  formTitle: string,
  questions: { id: string; label: string }[],
): MergeContext {
  const answers = Object.fromEntries(questions.map((q) => [q.id, "Sample answer"]));
  return {
    formTitle,
    responseId: "00000000-0000-4000-8000-000000000000",
    submittedAt: new Date(0).toISOString(),
    answers,
    hidden: {},
    score: "8",
    ending: "Thank you",
    respondentEmail: "respondent@example.com",
    booking: { type: "Intro call", time: "Mon 2 Dec, 10:00 (UTC)" },
    answerLines: questions
      .slice(0, 6)
      .map((q) => ({ label: q.label, value: "Sample answer" })),
  };
}
