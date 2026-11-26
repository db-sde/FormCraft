import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  notOnPlanMessage,
  type Entitlements,
  type Feature,
} from "@/domains/billing/entitlements";
import { trackAccountEvent } from "@/lib/analytics/account-events";
import { AI_OUT_OF_CREDITS, type AiFailure } from "./errors";

/**
 * The one way to call a model (docs/super-admin-design.md §3.10). A unit
 * test fails the build if anything else constructs a client or sends a
 * message.
 *
 * Before a call, the database decides in one statement whether it may run
 * (AI on, the feature on, today's platform spend under the ceiling, a
 * credit left on the plan, taken atomically) and with which model. After
 * it, tokens and cost are recorded from the API's own usage figures.
 * Prompts and replies are never stored.
 */

type Client = SupabaseClient<Database>;
type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** Every AI feature, as named in private.ai_settings (a unit test keeps the
 * two lists equal). */
export const AI_FEATURES = [
  "form_generate",
  "form_edit",
  "logic_rule",
  "form_review",
  "response_analysis",
  "response_summary",
  "follow_up",
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** Models a setting may choose. The database refuses any other value too,
 * so a bad setting can't route calls to an arbitrary model. Haiku has no
 * server-side fallback, so it is called without one. */
export const ALLOWED_MODELS = {
  "claude-opus-5-5": { serverFallback: true },
  "claude-sonnet-5-5": { serverFallback: true },
  "claude-haiku-5-5": { serverFallback: false },
} as const;
export type AllowedModel = keyof typeof ALLOWED_MODELS;

export function isAllowedModel(model: unknown): model is AllowedModel {
  return typeof model === "string" && Object.hasOwn(ALLOWED_MODELS, model);
}

/** Which plan feature each AI feature needs (pricing doc): writing and
 * editing forms from Starter, response insights from Pro. Follow-up
 * questions only need credits. */
export const AI_PLAN_FEATURE: Record<AiFeature, Feature | null> = {
  form_generate: "ai_form_tools",
  form_edit: "ai_form_tools",
  logic_rule: "ai_form_tools",
  form_review: "ai_form_tools",
  response_analysis: "ai_insights",
  response_summary: "ai_insights",
  follow_up: null,
};

export const AI_PAUSED: AiFailure = {
  ok: false,
  code: "limited",
  message: "AI is paused on FormCraft right now. Please try again a little later.",
};

/** What the caller sends: everything but the model and fallback, which
 * the gateway decides. */
export type AiRequest = Omit<BetaParams, "model" | "betas" | "fallbacks" | "stream">;

export type AiSession = {
  readonly feature: AiFeature;
  readonly model: AllowedModel;
  /** One model call, recorded with its cost. Throws what the SDK throws. */
  create(request: AiRequest, options?: { timeoutMs?: number }): Promise<BetaMessage>;
};

export type AiAttempt = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

/** Tokens per attempt, from the API's usage block. A refused attempt and
 * the fallback that served the reply are listed separately (each billed at
 * its own model's price); otherwise the top-level usage is the one attempt. */
export function usageAttempts(message: BetaMessage, requested: string): AiAttempt[] {
  const entries = (message.usage.iterations ?? []).filter(
    (e) => e.type === "message" || e.type === "fallback_message",
  );
  if (entries.length > 0) {
    return entries.map((e) => ({
      model: ("model" in e && e.model) || requested,
      input_tokens: e.input_tokens ?? 0,
      output_tokens: e.output_tokens ?? 0,
      cache_read_input_tokens: e.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: e.cache_creation_input_tokens ?? 0,
    }));
  }
  const u = message.usage;
  return [
    {
      model: message.model || requested,
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    },
  ];
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** No limit, for the database function (its argument is nullable). */
const SQL_NULL_LIMIT = null as unknown as number;

/**
 * Asks to make an AI call for this workspace's feature, taking one credit.
 * One credit covers the action, including a model's one retry to fix its
 * own draft; each model call is recorded separately.
 */
export async function beginAi(
  admin: Client,
  input: { feature: AiFeature; workspaceId: string; entitlements: Entitlements },
): Promise<{ ok: true; ai: AiSession } | AiFailure> {
  const needs = AI_PLAN_FEATURE[input.feature];
  if (needs && !input.entitlements[needs]) {
    return { ok: false, code: "limited", message: notOnPlanMessage(needs) };
  }
  const { data, error } = await admin.rpc("ai_begin", {
    p_workspace_id: input.workspaceId,
    p_feature: input.feature,
    p_credit_limit: input.entitlements.ai_credits_per_month ?? SQL_NULL_LIMIT,
  });
  if (error) throw error;
  const grant = data as unknown as
    | { ok: true; model: string; max_tokens: number | null; credits_used: number }
    | { ok: false; code: string };
  if (!grant.ok) return grant.code === "credits" ? AI_OUT_OF_CREDITS : AI_PAUSED;
  if (!isAllowedModel(grant.model)) {
    console.error(
      JSON.stringify({
        event: "ai_model_refused",
        model: grant.model,
        feature: input.feature,
      }),
    );
    return AI_PAUSED;
  }
  void trackAccountEvent({
    event: "ai_used",
    distinctId: input.workspaceId,
    workspaceId: input.workspaceId,
    properties: {
      creditsUsedThisMonth: Number(grant.credits_used),
      feature: input.feature,
    },
  });
  return {
    ok: true,
    ai: session(admin, input.workspaceId, input.feature, grant.model, grant.max_tokens),
  };
}

function session(
  admin: Client,
  workspaceId: string,
  feature: AiFeature,
  model: AllowedModel,
  maxTokens: number | null,
): AiSession {
  async function record(
    started: number,
    outcome: "ok" | "refusal" | "max_tokens" | "error",
    message: BetaMessage | null,
    errorKind: string | null,
  ) {
    const { error } = await admin.rpc("ai_record_usage", {
      p_workspace_id: workspaceId,
      p_feature: feature,
      p_requested_model: model,
      p_served_model: message?.model ?? model,
      p_attempts: (message ? usageAttempts(message, model) : []) as never,
      p_latency_ms: Math.round(performance.now() - started),
      p_outcome: outcome,
      p_error_kind: errorKind ?? undefined,
      p_request_id:
        (message as { _request_id?: string | null } | null)?._request_id ?? undefined,
    });
    // Recording never breaks the feature; a gap shows in the logs.
    if (error) {
      console.error(
        JSON.stringify({
          event: "ai_usage_not_recorded",
          feature,
          message: error.message,
        }),
      );
    }
  }

  return {
    feature,
    model,
    async create(request, options) {
      const body: BetaParams = {
        ...request,
        model,
        max_tokens: maxTokens
          ? Math.min(request.max_tokens, maxTokens)
          : request.max_tokens,
        ...(ALLOWED_MODELS[model].serverFallback
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      };
      const started = performance.now();
      let message: BetaMessage;
      try {
        message = await anthropic().beta.messages.create(
          body,
          options?.timeoutMs ? { timeout: options.timeoutMs, maxRetries: 0 } : undefined,
        );
      } catch (error) {
        const kind =
          error instanceof Anthropic.APIError
            ? `${error.constructor.name}:${error.status ?? ""}`
            : error instanceof Error
              ? error.name
              : "unknown";
        await record(started, "error", null, kind.slice(0, 60));
        throw error;
      }
      await record(
        started,
        message.stop_reason === "refusal"
          ? "refusal"
          : message.stop_reason === "max_tokens"
            ? "max_tokens"
            : "ok",
        message,
        null,
      );
      return message;
    },
  };
}
