import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema/validate";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { previewFromSchema, type FormPreview } from "@/domains/forms/queries";

type Client = SupabaseClient<Database>;

export type TemplateListItem = {
  id: string;
  title: string;
  category: string;
  description: string | null;
};

export type TemplateCard = TemplateListItem & {
  /** The first question in the template's theme, for the card art. */
  preview: FormPreview;
  /** Answerable questions (welcome screens and statements don't count). */
  questionCount: number;
};

/** For the template gallery. The schema itself isn't returned — only
 * the bits the card draws. */
export async function listTemplates(supabase: Client): Promise<TemplateCard[]> {
  const { data, error } = await supabase
    .from("templates")
    .select("id, title, category, description, schema")
    .order("sort_order", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const questions =
      (row.schema as { questions?: { type?: string }[] } | null)?.questions ?? [];
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      description: row.description,
      preview: previewFromSchema(row.schema),
      questionCount: questions.filter(
        (q) => q.type !== "welcome_screen" && q.type !== "statement",
      ).length,
    };
  });
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
