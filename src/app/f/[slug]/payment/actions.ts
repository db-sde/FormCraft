"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkoutForResponse } from "@/domains/payments/checkout";
import { createAdminClient } from "@/lib/supabase/admin";

/** "Try again" after a payment that didn't go through: a new Checkout
 * for the same response (the amount is worked out again on the server). */
export async function retryPaymentAction(
  responseId: string,
): Promise<{ message: string }> {
  if (!z.string().uuid().safeParse(responseId).success)
    return { message: "Payment not found." };
  // Back to wherever the respondent is (the app or a custom domain):
  // the browser's Origin, else the forwarded protocol and host.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto =
    h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin =
    h.get("origin") ??
    (host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_APP_URL ?? ""));
  const result = await checkoutForResponse(createAdminClient(), responseId, { origin });
  if (result && "url" in result) redirect(result.url);
  return { message: result && "error" in result ? result.error : "Nothing to pay." };
}
