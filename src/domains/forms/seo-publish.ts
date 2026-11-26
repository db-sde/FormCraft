import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { Entitlements } from "@/domains/billing/entitlements";
import type { FormSchemaV1 } from "./schema/v1";
import { readSeo, type FormSeoLive } from "./seo";
import { storeShareCard } from "./share-assets";
import { renderShareCard } from "./share-card";

type Client = SupabaseClient<Database>;

/**
 * On publish (developer spec item 1): the draft's link-preview settings
 * go live, and the automatic share card is made and stored. On a plan
 * without custom SEO only the card goes live (the settings stay saved for
 * an upgrade). A card that can't be made never stops the publish.
 */
export async function publishSeo(
  admin: Client,
  input: {
    formId: string;
    workspaceId: string;
    schema: FormSchemaV1;
    entitlements: Entitlements;
  },
): Promise<void> {
  const { data: form } = await admin
    .from("forms")
    .select("seo")
    .eq("id", input.formId)
    .maybeSingle();
  const draft = readSeo(form?.seo);
  const live: FormSeoLive = input.entitlements.custom_seo ? { ...draft } : {};
  try {
    const png = await renderShareCard({
      title: (live.title || input.schema.meta.title || "").toString(),
      theme: input.schema.theme,
      badge: !input.entitlements.remove_branding,
    });
    live.cardUrl = await storeShareCard(
      admin,
      `${input.workspaceId}/${input.formId}/cards`,
      png,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "share_card_failed",
        formId: input.formId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  await admin
    .from("forms")
    .update({ seo_live: live as unknown as Json })
    .eq("id", input.formId);
}
