import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { startPayment } from "./flow";

type Client = SupabaseClient<Database>;

/**
 * Starts a Stripe Checkout for a response (P2.17), through the shared
 * payment flow: `{ url }` to send the respondent to, `{ error }`, or null
 * when there's nothing (more) to pay. Razorpay forms pay in the form.
 */
export async function checkoutForResponse(
  admin: Client,
  responseId: string,
  urls: { origin: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string } | { error: string } | null> {
  const { data: response } = await admin
    .from("responses")
    .select("forms!inner(slug)")
    .eq("id", responseId)
    .maybeSingle();
  const slug = (response?.forms as { slug: string } | undefined)?.slug;
  if (!slug) return null;
  const result = await startPayment(admin, responseId, {
    origin: urls.origin,
    slug,
    fetch: fetchImpl,
  });
  if (result.kind === "redirect") return { url: result.url };
  if (result.kind === "paid") return null;
  if (result.kind === "error")
    return result.message === "There's nothing to pay."
      ? null
      : { error: result.message };
  return { error: "This form takes payment in the form itself." };
}
