import type { AiFeature, AiSession, AllowedModel } from "@/domains/ai/gateway";

/**
 * A gateway session for unit tests: the database's answer to "may this
 * call run?" is stubbed (yes, with `model`), and what the gateway records
 * after each call is kept in `recorded` instead of written anywhere.
 */
export async function testAiSession(
  feature: AiFeature,
  model: AllowedModel = "claude-opus-5-5",
): Promise<{ ai: AiSession; recorded: Record<string, unknown>[] }> {
  const { beginAi } = await import("@/domains/ai/gateway");
  const recorded: Record<string, unknown>[] = [];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "ai_begin") {
        return {
          data: { ok: true, model, max_tokens: null, credits_used: 1 },
          error: null,
        };
      }
      recorded.push(args);
      return { data: 0, error: null };
    },
  };
  const begun = await beginAi(admin as never, {
    feature,
    workspaceId: "00000000-0000-4000-8000-000000000001",
    entitlements: { ai_credits_per_month: null } as never,
  });
  if (!begun.ok) throw new Error(begun.message);
  return { ai: begun.ai, recorded };
}
