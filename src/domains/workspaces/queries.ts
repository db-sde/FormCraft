import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { customAlphabet } from "nanoid";
import { slugify } from "./validation";

type Client = SupabaseClient<Database>;

const slugSuffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "editor";
};

/** Returns the user's workspaces, oldest membership first — so the
 * first entry (what the app treats as "current") is the user's own
 * default workspace and stays put, rather than silently switching to
 * whichever workspace they were most recently added to.
 * Relies on RLS (`is_workspace_member`) to scope results — never pass
 * a userId filter here, the session's own identity is the boundary. */
export async function listWorkspacesForCurrentUser(
  supabase: Client,
): Promise<WorkspaceSummary[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name, slug)")
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? [])
    .filter(
      (
        row,
      ): row is typeof row & { workspaces: NonNullable<(typeof row)["workspaces"]> } =>
        Boolean(row.workspaces),
    )
    .map((row) => ({
      id: row.workspaces.id,
      name: row.workspaces.name,
      slug: row.workspaces.slug,
      role: row.role,
    }));
}

/** Ensures the current user has at least one workspace, creating a
 * default one (named after them) on first login if not. Workspace
 * slugs are globally unique, so each gets a random suffix — counting up
 * "-1", "-2"… would stop working after the fifth user sharing a name
 * (or the fifth with no name at all). Retries only cover the rare
 * random collision. */
export async function ensureDefaultWorkspace(
  supabase: Client,
  fullName: string | null,
): Promise<WorkspaceSummary> {
  const existing = await listWorkspacesForCurrentUser(supabase);
  if (existing.length > 0) return existing[0];

  const baseName = fullName ? `${fullName}'s Workspace` : "My Workspace";
  const baseSlug = slugify(fullName ?? "").slice(0, 40) || "workspace";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = `${baseSlug}-${slugSuffix()}`;
    const { data, error } = await supabase.rpc("create_workspace_with_owner", {
      workspace_name: baseName,
      workspace_slug: slug,
    });

    if (!error && data) {
      return { id: data.id, name: data.name, slug: data.slug, role: "owner" };
    }
    if (error && !error.message.includes("duplicate key")) {
      throw error;
    }
  }

  throw new Error("failed to allocate a unique workspace slug after 5 attempts");
}
