import { z } from "zod";

/**
 * A Zod schema as a structured-output JSON schema. Built here rather
 * than with the SDK's zod helper because that helper (as of
 * @anthropic-ai/sdk 0.131) moves `enum` into the description, so the
 * model would only be told the allowed values instead of constrained to
 * them. Keeps what structured outputs enforce (types, enums, required,
 * closed objects), drops what they don't (numeric bounds, lengths); the
 * reply is validated against the full Zod schema anyway.
 */
const DROPPED = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "maxItems",
]);

function strict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strict);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED.has(key)) continue;
    if (key === "minItems" && value !== 0 && value !== 1) continue;
    if (key === "properties" || key === "$defs") {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, strict(v)]),
      );
    } else {
      out[key] = strict(value);
    }
  }
  if (out.type === "object") {
    out.additionalProperties = false;
    out.required = Object.keys((out.properties as object) ?? {});
  }
  return out;
}

export function jsonOutputFormat(schema: z.ZodType): {
  type: "json_schema";
  schema: Record<string, unknown>;
} {
  return {
    type: "json_schema",
    schema: strict(z.toJSONSchema(schema, { io: "output" })) as Record<string, unknown>,
  };
}

/** The reply's JSON text, checked against the schema. */
export function parseJsonReply<T>(
  content: { type: string; text?: string }[],
  schema: z.ZodType<T>,
): T | null {
  const text = content.find((b) => b.type === "text")?.text;
  if (!text) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
