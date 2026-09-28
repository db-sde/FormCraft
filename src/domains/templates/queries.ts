import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema/validate";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

type Client = SupabaseClient<Database>;

export type TemplateListItem = {
  id: string;
  title: string;
  category: string;
  description: string | null;
};

/** For the template picker gallery — schema is intentionally left out
 * (it can be large and the list view never renders it). */
export async function listTemplates(supabase: Client): Promise<TemplateListItem[]> {
  const { data, error } = await supabase
    .from("templates")
    .select("id, title, category, description")
    .order("sort_order", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
  }));
}

export type TemplateWithSchema = TemplateListItem & { schema: FormSchemaV1 };

export async function getTemplateById(
  supabase: Client,
  id: string,
): Promise<TemplateWithSchema | null> {
  const { data, error } = await supabase
    .from("templates")
    .select("id, title, category, description, schema")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    title: data.title,
    category: data.category,
    description: data.description,
    // A template's schema was already validated at seed time (see
    // scripts/seed-templates.ts), but re-parsing here is cheap and
    // means a hand-edited row in the DB can never hand the builder an
    // invalid schema silently.
    schema: parseFormSchema(data.schema),
  };
}
