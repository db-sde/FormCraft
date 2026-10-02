import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { getWorkspacePlan } from "@/domains/billing/entitlements";
import { walkForm } from "@/domains/logic/walk";
import { amountToCharge, createCheckout, readPaymentConfig } from "./stripe";

type Client = SupabaseClient<Database>;

/**
 * After a response is saved: if its form takes payment (and the plan
 * includes payments), start a Stripe Checkout for the amount the server
 * works out — the form's fixed price, or the calculated variable from
 * this response's own answers. Null when there's nothing to pay. An
 * already-paid response is never charged again.
 */
export async function checkoutForResponse(
  admin: Client,
  responseId: string,
  urls: { origin: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string } | { error: string } | null> {
  const { data: response } = await admin
    .from("responses")
    .select(
      "id, form_id, form_version_id, hidden_fields, random_seed, completed_at, status, forms!inner(workspace_id, slug, payment_config)",
    )
    .eq("id", responseId)
    .single();
  if (!response || response.status !== "completed") return null;
  const form = response.forms as {
    workspace_id: string;
    slug: string;
    payment_config: unknown;
  };
  const config = readPaymentConfig(form.payment_config as never);
  if (!config) return null;
  const { entitlements } = await getWorkspacePlan(admin, form.workspace_id);
  if (!entitlements.payments) return null;

  const { data: existing } = await admin
    .from("payments")
    .select("status")
    .eq("response_id", responseId)
    .maybeSingle();
  if (existing?.status === "paid") return null;

  const [{ data: version }, { data: answerRows }] = await Promise.all([
    admin
      .from("form_versions")
      .select("schema")
      .eq("id", response.form_version_id)
      .single(),
    admin.from("answers").select("question_id, value").eq("response_id", responseId),
  ]);
  const hidden = Object.fromEntries(
    Object.entries((response.hidden_fields ?? {}) as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  const walk = walkForm(
    compileFormSchema(parseFormSchema(version!.schema)),
    Object.fromEntries((answerRows ?? []).map((a) => [a.question_id, a.value])),
    {
      hidden,
      seed: response.random_seed ?? undefined,
      now: response.completed_at ? new Date(response.completed_at) : undefined,
    },
  );
  const amount = amountToCharge(config, walk.variables);
  if (!amount.ok) return { error: amount.message };

  const back = `${urls.origin}/f/${form.slug}/payment`;
  const result = await createCheckout(
    admin,
    {
      workspaceId: form.workspace_id,
      formId: response.form_id,
      responseId,
      config,
      amountMinor: amount.minor,
      successUrl: `${back}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${back}?response=${responseId}&canceled=1`,
    },
    fetchImpl,
  );
  return result.ok ? { url: result.url } : { error: result.message };
}
