import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import type { Value } from "@/domains/forms/schema/logic-model";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { walkForm } from "@/domains/logic/walk";
import { todayIn } from "@/domains/logic/expressions";
import { evaluateCondition } from "@/domains/logic/conditions";
import type { Condition } from "@/domains/forms/schema/logic-model";
import { formatAnswerValue } from "./format";
import { getOrder, type SavedOrder } from "./orders";

type Client = SupabaseClient<Database>;

/**
 * Everything the Phase 3 senders (documents, rule emails, digests) need
 * about one response, read once with the service role: its own form
 * version, answers, the path it took and its variables (replayed at its
 * submission time), uploads, order and payment.
 */
export type ResponseContext = {
  id: string;
  status: string;
  completedAt: string | null;
  form: { id: string; title: string; workspaceId: string };
  schema: FormSchemaV1;
  answers: Record<string, unknown>;
  hidden: Record<string, string>;
  /** Questions on the path taken, in order. */
  path: QuestionV1[];
  variables: Record<string, Value>;
  endingId: string | null;
  today: string;
  uploads: Map<
    string,
    { questionId: string; name: string; storagePath: string; createdAt: string }
  >;
  order: SavedOrder | null;
  payment: ResponsePayment | null;
};

/** A response's payment (F-22): amounts in minor units. */
export type ResponsePayment = {
  status: string;
  amount: number;
  currency: string;
  subtotal: number | null;
  discount: number;
  couponCode: string | null;
  provider: string;
  providerPaymentId: string | null;
  paidAt: string | null;
  refundedAmount: number;
};

const SCREENS = new Set(["welcome_screen", "statement", "page_break"]);

export async function loadResponseContext(
  admin: Client,
  responseId: string,
): Promise<ResponseContext | null> {
  const { data: response } = await admin
    .from("responses")
    .select(
      "id, status, completed_at, ending_id, form_version_id, hidden_fields, random_seed, forms!inner(id, title, workspace_id)",
    )
    .eq("id", responseId)
    .maybeSingle();
  if (!response) return null;
  const form = response.forms as { id: string; title: string; workspace_id: string };
  const [
    { data: version },
    { data: answerRows },
    { data: uploadRows },
    order,
    { data: payment },
  ] = await Promise.all([
    admin
      .from("form_versions")
      .select("schema")
      .eq("id", response.form_version_id)
      .single(),
    admin.from("answers").select("question_id, value").eq("response_id", responseId),
    admin
      .from("uploads")
      .select("id, question_id, original_filename, storage_path, created_at, status")
      .eq("response_id", responseId),
    getOrder(admin, responseId),
    admin
      .from("payments")
      .select(
        "status, amount, currency, subtotal, discount, coupon_code, provider, provider_payment_id, paid_at, refunded_amount",
      )
      .eq("response_id", responseId)
      .maybeSingle(),
  ]);
  if (!version) return null;
  const schema = parseFormSchema(version.schema);
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
  const now = response.completed_at ? new Date(response.completed_at) : new Date();
  const walk = walkForm(compileFormSchema(schema), answers, {
    hidden,
    now,
    seed: response.random_seed ?? undefined,
  });
  const visited = new Set(walk.visitedQuestionIds);
  return {
    id: response.id,
    status: response.status,
    completedAt: response.completed_at,
    form: { id: form.id, title: form.title, workspaceId: form.workspace_id },
    schema,
    answers,
    hidden,
    path: [...schema.questions]
      .sort((a, b) => a.order - b.order)
      .filter((q) => visited.has(q.id)),
    variables: walk.variables,
    endingId: response.ending_id ?? walk.endingId,
    today: todayIn(now, schema.meta.timezone),
    uploads: new Map(
      (uploadRows ?? [])
        .filter((u) => u.status !== "quarantined" && u.status !== "deleted")
        .map((u) => [
          u.id,
          {
            questionId: u.question_id,
            name: u.original_filename,
            storagePath: u.storage_path,
            createdAt: u.created_at,
          },
        ]),
    ),
    order,
    payment: payment
      ? {
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          subtotal: payment.subtotal,
          discount: payment.discount,
          couponCode: payment.coupon_code,
          provider: payment.provider,
          providerPaymentId: payment.provider_payment_id,
          paidAt: payment.paid_at,
          refundedAmount: payment.refunded_amount,
        }
      : null,
  };
}

/** The answered questions on the path, as label → readable text. */
export function answerLines(
  ctx: ResponseContext,
): { question: QuestionV1; label: string; value: string }[] {
  const uploadNames = new Map([...ctx.uploads].map(([id, u]) => [id, u.name]));
  return ctx.path
    .filter((q) => !SCREENS.has(q.type))
    .map((q) => ({
      question: q,
      label: q.label.trim() || "Untitled question",
      value: formatAnswerValue(q, ctx.answers[q.id], { uploadNames }),
    }));
}

/** Whether a logic condition holds for this response (variables by id,
 * "today" pinned to its submission). Anything unknown is false. */
export function conditionHolds(ctx: ResponseContext, condition: Condition): boolean {
  try {
    return evaluateCondition(condition, {
      answers: ctx.answers,
      variables: ctx.variables,
      hidden: ctx.hidden,
      today: ctx.today,
    });
  } catch {
    return false;
  }
}
