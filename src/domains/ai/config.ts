import "server-only";

export const AI_MODEL = "claude-opus-5-5";
export const MAX_INSTRUCTION_LENGTH = 600;
export const MAX_FORM_PROMPT_LENGTH = 2000;

/** AI features need a server-side key; without one they say so. */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
