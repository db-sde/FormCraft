import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  describeFormForAi,
  draftToRule,
  RuleDraft,
  type DraftResult,
} from "./rule-draft";

import { AI_MODEL } from "./config";
import { LOGIC_GUIDE } from "./prompts";
import { jsonOutputFormat, parseJsonReply } from "./output-format";

const SYSTEM = `You turn a form creator's description of form logic into one rule for a form builder. Fill the draft exactly; a deterministic engine runs it, so only use what the form has.

${LOGIC_GUIDE}

If the rule needs a variable the form doesn't have, add it to newVariables (lowercase letters, numbers, _; start with a letter) and use it. If the request can't be expressed (it needs something this engine doesn't do, or refers to things the form doesn't have), set possible to false and explain why in reason.`;

/**
 * Proposes a rule for the creator to review (never applied here). The
 * model's draft is translated and validated by draftToRule; if that
 * fails, the model gets one chance to fix it with the problem spelled
 * out, then the problem is reported as is.
 */
export async function proposeRule(
  instruction: string,
  schema: FormSchemaV1,
): Promise<DraftResult> {
  const client = new Anthropic();
  const format = jsonOutputFormat(RuleDraft);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `${describeFormForAi(schema)}\n\nThe creator wants:\n${instruction}`,
    },
  ];

  let result: DraftResult = { ok: false, message: "No rule came back. Try rephrasing." };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format },
      system: SYSTEM,
      messages,
    });
    if (response.stop_reason === "refusal") {
      return { ok: false, message: "That request can't be turned into a rule." };
    }
    const draft = parseJsonReply(response.content, RuleDraft);
    if (!draft) return result;
    result = draftToRule(draft, schema);
    if (result.ok) return result;
    if (!draft.possible) return result;
    messages.push(
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: `That draft can't be used: ${result.message} Fix it, or set possible to false if it can't be done.`,
      },
    );
  }
  return result;
}
