import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL } from "./config";
import { LOGIC_GUIDE } from "./prompts";
import { jsonOutputFormat, parseJsonReply } from "./output-format";
import { buildGeneratedForm, FormDraft, type FormBuildResult } from "./form-draft";

const SYSTEM = `You design forms for a form builder from a creator's description. Fill the draft; the builder turns it into a real form, so use only what it supports.

Write like a friendly, plain-spoken person: short questions, one thing per question, no jargon. Keep forms as short as the goal allows (usually 4–12 questions). Use the most specific question type: email for emails, contact_info to collect name/email/phone together, single_select/dropdown for one choice, multi_select for several, yes_no, number, date, rating (5 or 10), opinion_scale (0–10), statement for a message with no answer. Questions are numbered from q1 in the order you list them (the welcome screen is added for you and has no number).

Endings are referred to as ending_1, ending_2, … in the order you list them; mark one as the default. Add logic only when the description calls for it — scoring, outcomes, branching, eligibility, calculations:
- Quizzes: a number variable (e.g. score); give each option points for it and mark correct answers; endings for score bands chosen by form_completed rules.
- Personality/outcome quizzes: one number variable per outcome, option points toward them, one ending per outcome and a form_completed rule with go_to_highest.
- Branching: question_answered rules with jump_to_question (forward only) or jump_to_ending.

${LOGIC_GUIDE}

Variable names use lowercase letters, numbers and _, starting with a letter. If the request isn't something a form can do, set possible to false and explain why in reason.`;

/** A whole form from a description. Returned for the caller to create;
 * nothing is stored here. */
export async function generateForm(prompt: string): Promise<FormBuildResult> {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: jsonOutputFormat(FormDraft) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") {
    return { ok: false, message: "That request can't be turned into a form." };
  }
  const draft = parseJsonReply(response.content, FormDraft);
  if (response.stop_reason === "max_tokens" || !draft) {
    return {
      ok: false,
      message: "That form came out too big. Try a shorter description.",
    };
  }
  return buildGeneratedForm(draft);
}
