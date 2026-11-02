import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { describeFormForAi } from "./rule-draft";
import { AI_MODEL } from "./config";
import { LOGIC_GUIDE } from "./prompts";
import { jsonOutputFormat, parseJsonReply } from "./output-format";
import { applyEdit, describeThemeForAi, EditDraft, type EditResult } from "./form-edit";

const SYSTEM = `You edit a form in a form builder for its creator. Turn their request into operations on the form as it is now; a deterministic engine applies them and checks the result, and the creator reviews every change before it's saved.

Rules:
- Question numbers always refer to the form as it is now (before your operations). Use afterNumber 0 to put something first.
- update_question changes only the fields you set; leave the rest null and options [] to keep them. To change choices, give the full new option list in order.
- Only use the question types listed. Don't invent questions, options or endings the creator didn't ask for.
- For logic, use add_rule with a complete rule, numbering questions as the form will be after your other operations.
- If the request can't be done with these operations, set possible to false and explain why in reason.

${LOGIC_GUIDE}`;

/**
 * Proposes an edit for the creator to review (never applied here). If the
 * draft fails the form's checks, the model gets one chance to fix it with
 * the problem spelled out; then the problem is reported as is.
 */
export async function proposeFormEdit(
  instruction: string,
  schema: FormSchemaV1,
): Promise<EditResult> {
  const client = new Anthropic();
  const format = jsonOutputFormat(EditDraft);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `${describeFormForAi(schema)}\n${describeThemeForAi(schema)}\n\nThe creator wants:\n${instruction}`,
    },
  ];
  let result: EditResult = {
    ok: false,
    message: "No changes came back. Try rephrasing.",
  };
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
      return { ok: false, message: "That request can't be turned into an edit." };
    }
    const draft = parseJsonReply(response.content, EditDraft);
    if (!draft) return result;
    result = applyEdit(schema, draft);
    if (result.ok || !draft.possible) return result;
    messages.push(
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: `That edit can't be applied: ${result.message} Fix it and send the whole edit again.`,
      },
    );
  }
  return result;
}
