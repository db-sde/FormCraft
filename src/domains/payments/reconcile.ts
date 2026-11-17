import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadCredential } from "@/domains/integrations/credentials";
import { confirmAttemptPaid } from "./flow";
import {
  fetchRazorpayOrderPayments,
  paymentSettled,
  type RazorpaySecrets,
} from "./razorpay";
import { refreshFromStripe } from "./stripe-events";

type Client = SupabaseClient<Database>;

/**
 * Payment reconciliation (foundations §5). Provider events can arrive
 * late, twice or never; the webhook handlers already make repeats
 * harmless. This covers "never": every 15 minutes, payments still
 * pending after 15 minutes (and under 3 days old) are asked about
 * directly, each at most once an hour, and whatever the provider says is
 * applied through the same idempotent path its webhook would have taken.
 * Nothing here can mark a payment paid that the provider doesn't call
 * paid, or undo a paid one.
 */
const BATCH = 25;

export type ReconcileSummary = {
  checked: number;
  paid: number;
  unchanged: number;
  errors: number;
};

export async function reconcilePendingPayments(
  admin: Client,
  fetchImpl: typeof fetch = fetch,
): Promise<ReconcileSummary> {
  const { data: due, error } = await admin.rpc("payment_attempts_to_reconcile", {
    p_limit: BATCH,
  });
  if (error) throw error;
  const summary: ReconcileSummary = { checked: 0, paid: 0, unchanged: 0, errors: 0 };
  for (const attempt of due ?? []) {
    summary.checked += 1;
    // Asked now, whatever the answer: not again for an hour.
    await admin
      .from("payment_attempts")
      .update({ checked_at: new Date().toISOString() })
      .eq("id", attempt.id);
    try {
      const { data: form } = await admin
        .from("responses")
        .select("forms!inner(workspace_id)")
        .eq("id", attempt.response_id)
        .maybeSingle();
      const workspaceId = (form?.forms as { workspace_id: string } | undefined)
        ?.workspace_id;
      if (!workspaceId) {
        summary.unchanged += 1;
        continue;
      }
      if (attempt.provider === "stripe") {
        const status = await refreshFromStripe(
          admin,
          workspaceId,
          attempt.provider_ref,
          fetchImpl,
        );
        if (status === "paid") summary.paid += 1;
        else if (status === null) summary.errors += 1;
        else summary.unchanged += 1;
        continue;
      }
      const secrets = await loadCredential<RazorpaySecrets>(
        admin,
        workspaceId,
        "razorpay",
      );
      if (!secrets) {
        summary.errors += 1;
        continue;
      }
      const payments = await fetchRazorpayOrderPayments(
        secrets,
        attempt.provider_ref,
        fetchImpl,
      );
      if (!payments.ok) {
        summary.errors += 1;
        continue;
      }
      const settled = payments.data.items.find(paymentSettled);
      if (settled) {
        const outcome = await confirmAttemptPaid(admin, attempt.provider_ref, settled.id);
        if (outcome === "paid") summary.paid += 1;
        else summary.unchanged += 1;
      } else {
        summary.unchanged += 1;
      }
    } catch {
      summary.errors += 1;
    }
  }
  return summary;
}
