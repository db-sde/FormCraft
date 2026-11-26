"use server";

import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";
import { recordAudit } from "@/domains/audit/record";
import { ThemeV1 } from "@/domains/forms/schema/v1";
import type { Json } from "@/lib/supabase/database.types";

export type BrandTheme = { id: string; name: string; theme: ThemeV1 };

/** The workspace's saved brand themes (developer spec item 3), newest
 * first. Any member may see them. */
export async function listBrandThemesAction(): Promise<BrandTheme[]> {
  const { supabase, workspace } = await getCurrentWorkspace();
  const { data } = await supabase
    .from("brand_themes")
    .select("id, name, theme")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []).flatMap((row) => {
    const parsed = ThemeV1.safeParse(row.theme);
    return parsed.success ? [{ id: row.id, name: row.name, theme: parsed.data }] : [];
  });
}

/** Saves the current look as a brand theme (owners, admins, editors).
 * Custom CSS and uploaded fonts aren't kept: brand themes are looks. */
export async function saveBrandThemeAction(
  name: string,
  theme: unknown,
): Promise<{ ok: true; theme: BrandTheme } | { ok: false; message: string }> {
  const parsedName = z.string().trim().min(1).max(60).safeParse(name);
  const parsedTheme = ThemeV1.safeParse(theme);
  if (!parsedName.success)
    return { ok: false, message: "Name it (up to 60 characters)." };
  if (!parsedTheme.success) return { ok: false, message: "That theme isn't valid." };
  const { supabase, workspace, user } = await getCurrentWorkspace();
  if (!canEdit(workspace.role))
    return { ok: false, message: "You have view-only access." };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { customCss, customFont, preset, ...look } = parsedTheme.data;
  const { data, error } = await supabase
    .from("brand_themes")
    .insert({
      workspace_id: workspace.id,
      name: parsedName.data,
      theme: look as unknown as Json,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      message: error?.message.includes("50 brand themes")
        ? "A workspace can keep up to 50 brand themes. Delete one first."
        : "Couldn't save it.",
    };
  }
  await recordAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "brand_theme.saved",
    target: { type: "brand_theme", id: data.id },
    metadata: { name: parsedName.data },
  });
  return {
    ok: true,
    theme: { id: data.id, name: parsedName.data, theme: look as ThemeV1 },
  };
}

export async function deleteBrandThemeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Not found." };
  const { supabase, workspace, user } = await getCurrentWorkspace();
  if (!canEdit(workspace.role))
    return { ok: false, message: "You have view-only access." };
  const { data, error } = await supabase
    .from("brand_themes")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .select("id");
  if (error || !data?.length) return { ok: false, message: "Couldn't delete it." };
  await recordAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "brand_theme.deleted",
    target: { type: "brand_theme", id },
  });
  return { ok: true };
}
