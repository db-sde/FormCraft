import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { AI_MODEL } from "./config";
import { jsonOutputFormat, parseJsonReply } from "./output-format";

export type StructuredResult<T> =
  { ok: true; data: T } | { ok: false; reason: "refusal" | "invalid" | "too_long" };

/** One structured-output request: the reply must match `schema` (enums
 * enforced by the API, everything else checked here). */
export async function askStructured<T>(input: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Abort after this many milliseconds (respondent-facing calls). */
  timeoutMs?: number;
}): Promise<StructuredResult<T>> {
  const client = new Anthropic(
    input.timeoutMs ? { timeout: input.timeoutMs, maxRetries: 0 } : undefined,
  );
  const response = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: input.maxTokens ?? 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: input.effort ?? "medium",
      format: jsonOutputFormat(input.schema),
    },
    system: input.system,
    messages: [{ role: "user", content: input.prompt }],
  });
  if (response.stop_reason === "refusal") return { ok: false, reason: "refusal" };
  if (response.stop_reason === "max_tokens") return { ok: false, reason: "too_long" };
  const data = parseJsonReply(response.content, input.schema);
  return data === null ? { ok: false, reason: "invalid" } : { ok: true, data };
}
