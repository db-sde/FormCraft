import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { notSetUpMessage } from "@/lib/not-set-up";

export type AiFailure = {
  ok: false;
  code: "not_configured" | "limited" | "failed";
  message: string;
};

export const AI_NOT_CONFIGURED: AiFailure = {
  ok: false,
  code: "not_configured",
  message: notSetUpMessage("AI"),
};

export const AI_OUT_OF_CREDITS: AiFailure = {
  ok: false,
  code: "limited",
  message: "You've used this month's AI credits on your plan.",
};

/** What to tell the creator when a model call throws. */
export function aiFailure(error: unknown): AiFailure {
  if (error instanceof Anthropic.RateLimitError) {
    return {
      ok: false,
      code: "limited",
      message: "The AI is busy. Try again in a minute.",
    };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return {
      ok: false,
      code: "not_configured",
      message: "AI is having a moment on our side. Please try again a little later.",
    };
  }
  return { ok: false, code: "failed", message: "The AI couldn't be reached. Try again." };
}
