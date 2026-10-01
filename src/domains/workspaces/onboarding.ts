import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type OnboardingStep = { id: string; label: string; done: boolean; href: string };

export type WorkspaceOverview = {
  formCount: number;
  memberCount: number;
  steps: OnboardingStep[];
};

const STARTER_THEME = {
  primaryColor: "#0f172a",
  backgroundColor: "#ffffff",
};

/**
 * What the sidebar needs: how many forms and members, and the four
 * "Getting started" steps (create, theme, publish, connect Sheets).
 * Runs as the signed-in user, so row-level security scopes every count.
 */
export async function getWorkspaceOverview(
  supabase: Client,
  workspaceId: string,
): Promise<WorkspaceOverview> {
  const [forms, members, sheets] = await Promise.all([
    supabase
      .from("forms")
      .select("id, form_versions(status, schema)")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .in("form_versions.status", ["draft", "published"])
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    supabase
      .from("sheets_connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);

  const rows = forms.data ?? [];
  const { count: totalForms } = await supabase
    .from("forms")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const first = rows[0]?.id;
  const themed = rows.some((f) =>
    (f.form_versions ?? []).some((v) => {
      const theme = (v.schema as { theme?: Record<string, unknown> } | null)?.theme;
      return (
        !!theme &&
        (theme.primaryColor !== STARTER_THEME.primaryColor ||
          theme.backgroundColor !== STARTER_THEME.backgroundColor)
      );
    }),
  );
  const live = rows.some((f) =>
    (f.form_versions ?? []).some((v) => v.status === "published"),
  );
  const formHref = (tab = "") => (first ? `/forms/${first}${tab}` : "/dashboard");

  return {
    formCount: totalForms ?? rows.length,
    memberCount: members.count ?? 1,
    steps: [
      { id: "create", label: "Create a form", done: rows.length > 0, href: "/dashboard" },
      {
        id: "theme",
        label: "Pick a theme",
        done: themed,
        href: formHref("?panel=theme"),
      },
      { id: "publish", label: "Publish it", done: live, href: formHref("/share") },
      {
        id: "sheets",
        label: "Connect Google Sheets",
        done: (sheets.count ?? 0) > 0,
        href: formHref("/integrations"),
      },
    ],
  };
}
