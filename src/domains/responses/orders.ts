import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { walkForm } from "@/domains/logic/walk";
import { orderForResponse, type OrderLine } from "@/domains/forms/products";

type Client = SupabaseClient<Database>;

export type SavedOrder = { currency: string; lines: OrderLine[]; total: number };

/**
 * Saves the order a completed response placed with product blocks
 * (F-04): items, prices and the total worked out on the server from the
 * response's own published version and the answers on the path it took —
 * never from anything the browser sent besides quantities. Written once:
 * a repeat (a duplicate submit) leaves the first row as it is. Returns
 * the order, or null when nothing was ordered. Service role.
 */
export async function saveOrder(
  admin: Client,
  responseId: string,
): Promise<SavedOrder | null> {
  const { data: response } = await admin
    .from("responses")
    .select("form_id, form_version_id, status, hidden_fields, completed_at, random_seed")
    .eq("id", responseId)
    .maybeSingle();
  if (!response || response.status !== "completed") return null;

  // Most forms have no product block: stop before loading answers.
  const { data: version } = await admin
    .from("form_versions")
    .select("schema")
    .eq("id", response.form_version_id)
    .single();
  if (!version) return null;
  const schema = parseFormSchema(version.schema);
  if (!schema.questions.some((q) => q.type === "products")) return null;
  const { data: answerRows } = await admin
    .from("answers")
    .select("question_id, value")
    .eq("response_id", responseId);

  const answers = Object.fromEntries(
    (answerRows ?? []).map((a) => [a.question_id, a.value]),
  );
  const hidden =
    response.hidden_fields && typeof response.hidden_fields === "object"
      ? (Object.fromEntries(
          Object.entries(response.hidden_fields as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        ) as Record<string, string>)
      : {};
  const walk = walkForm(compileFormSchema(schema), answers, {
    hidden,
    now: response.completed_at ? new Date(response.completed_at) : undefined,
    seed: response.random_seed ?? undefined,
  });
  const onPath = new Set(walk.visitedQuestionIds);
  const order = orderForResponse(
    schema.questions.filter((q) => onPath.has(q.id)),
    answers,
  );
  if (!order) return null;

  const { error } = await admin.from("response_orders").upsert(
    {
      response_id: responseId,
      form_id: response.form_id,
      currency: order.currency,
      lines: order.lines as unknown as Json,
      total_amount: order.total,
    },
    { onConflict: "response_id", ignoreDuplicates: true },
  );
  if (error) throw error;
  return order;
}

/** A response's saved order, read as the caller (RLS). */
export async function getOrder(
  supabase: Client,
  responseId: string,
): Promise<SavedOrder | null> {
  const { data } = await supabase
    .from("response_orders")
    .select("currency, lines, total_amount")
    .eq("response_id", responseId)
    .maybeSingle();
  if (!data) return null;
  return {
    currency: data.currency,
    lines: (Array.isArray(data.lines) ? data.lines : []) as unknown as OrderLine[],
    total: data.total_amount,
  };
}
