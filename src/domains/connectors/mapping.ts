import { z } from "zod";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import {
  ADDRESS_FIELDS,
  ADDRESS_FIELD_LABELS,
  CONTACT_FIELD_LABELS,
  CONTACT_FIELDS,
} from "@/domains/forms/schema/question-types";
import { formatAnswerValue } from "@/domains/responses/format";
import type { ResponseContext } from "@/domains/responses/context";

/**
 * Field mapping for connectors (master spec §5.3, Phase 6): each row says
 * which destination field gets which value from a response. Sources:
 *
 * - `answer:<questionId>` — the answer, as a number, true/false or text
 *   (choices as their labels, like exports);
 * - `answer:<questionId>.<part>` — one part of a contact or address
 *   answer (`.email`, `.city`…);
 * - `meta:response_id` | `meta:submitted_at` | `meta:form_title`;
 * - `hidden:<name>` — a URL field; `variable:<name>` — a score or result;
 * - `text:<value>` — fixed text (a tag, a lead source).
 *
 * Uploads and signatures are never sent out.
 */

export const MappingRow = z.object({
  field: z.string().min(1).max(200),
  source: z.string().min(1).max(300),
});
export type MappingRow = z.infer<typeof MappingRow>;
export const Mapping = z.array(MappingRow).max(100);

export type MappingValue = string | number | boolean | null;

/** What a mapping reads: a loaded response (see responses/context). */
export type MappingContext = Pick<
  ResponseContext,
  "id" | "completedAt" | "form" | "schema" | "answers" | "hidden" | "variables"
> & {
  /** Questions on the path the respondent took; answers left behind on
   * a skipped branch aren't sent. Absent: every answer counts. */
  path?: { id: string }[];
};

const PRIVATE = new Set(["file_upload", "signature"]);
const NUMERIC = new Set(["number", "rating", "opinion_scale"]);

function answerValue(q: QuestionV1, raw: unknown): MappingValue {
  if (raw === undefined || raw === null || raw === "") return null;
  if (PRIVATE.has(q.type)) return null;
  if (NUMERIC.has(q.type) && typeof raw === "number") return raw;
  if (q.type === "yes_no" && typeof raw === "boolean") return raw;
  const text = formatAnswerValue(q, raw);
  return text === "" ? null : text;
}

export function resolveSource(ctx: MappingContext, source: string): MappingValue {
  const [kind, ...rest] = source.split(":");
  const ref = rest.join(":");
  switch (kind) {
    case "answer": {
      const [id, part] = ref.split(".");
      const q = ctx.schema.questions.find((x) => x.id === id);
      if (!q) return null;
      if (ctx.path && !ctx.path.some((x) => x.id === id)) return null;
      const raw = ctx.answers[id];
      if (part) {
        const v =
          raw && typeof raw === "object" ? (raw as Record<string, unknown>)[part] : null;
        return typeof v === "string" && v.trim() ? v.trim() : null;
      }
      return answerValue(q, raw);
    }
    case "meta":
      if (ref === "response_id") return ctx.id;
      if (ref === "submitted_at") return ctx.completedAt;
      if (ref === "form_title") return ctx.form.title;
      return null;
    case "hidden":
      return ctx.hidden[ref] ?? null;
    case "variable": {
      const v = (ctx.schema.variables ?? []).find((x) => x.name === ref);
      const value = v ? ctx.variables[v.id] : null;
      return typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
        ? value
        : value === null || value === undefined
          ? null
          : String(value);
    }
    case "text":
      return ref.slice(0, 500);
    default:
      return null;
  }
}

/** The mapped values, skipping empty ones (a destination keeps what it
 * had rather than being blanked). */
export function applyMapping(
  ctx: MappingContext,
  mapping: MappingRow[],
): Record<string, MappingValue> {
  const out: Record<string, MappingValue> = {};
  for (const row of mapping) {
    const value = resolveSource(ctx, row.source);
    if (value !== null && value !== "") out[row.field] = value;
  }
  return out;
}

/** What a mapping can read from a form, for the builder's pickers. */
export function sourceOptions(schema: FormSchemaV1): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let n = 0;
  for (const q of [...schema.questions].sort((a, b) => a.order - b.order)) {
    if (q.type === "welcome_screen" || q.type === "page_break" || q.type === "statement")
      continue;
    n += 1;
    if (PRIVATE.has(q.type)) continue;
    const label = `${n} · ${q.label.trim() || "Untitled"}`;
    if (q.type === "contact_info") {
      for (const f of CONTACT_FIELDS) {
        if (q.settings.fields.includes(f))
          out.push({
            value: `answer:${q.id}.${f}`,
            label: `${label} → ${CONTACT_FIELD_LABELS[f]}`,
          });
      }
      continue;
    }
    if (q.type === "address") {
      for (const f of ADDRESS_FIELDS) {
        if (q.settings.fields.includes(f))
          out.push({
            value: `answer:${q.id}.${f}`,
            label: `${label} → ${ADDRESS_FIELD_LABELS[f]}`,
          });
      }
      continue;
    }
    out.push({ value: `answer:${q.id}`, label });
  }
  for (const v of schema.variables ?? [])
    out.push({ value: `variable:${v.name}`, label: `Result: ${v.name}` });
  for (const h of schema.hiddenFields ?? [])
    out.push({ value: `hidden:${h.name}`, label: `URL field: ${h.name}` });
  out.push(
    { value: "meta:response_id", label: "Response ID" },
    { value: "meta:submitted_at", label: "Submitted at" },
    { value: "meta:form_title", label: "Form title" },
  );
  return out;
}

/** The answer that holds an email address, from a mapping source. */
export function emailFrom(
  ctx: MappingContext,
  source: string | undefined,
): string | null {
  if (!source) return null;
  const v = resolveSource(ctx, source);
  return typeof v === "string" &&
    /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(v.trim())
    ? v.trim().toLowerCase()
    : null;
}
