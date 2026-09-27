import { z } from "zod";

export const CreateWorkspaceInput = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(200),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInput>;

/** Derives a URL-safe slug candidate from a workspace name. Uniqueness
 * is enforced by the DB constraint; callers should retry with a suffix
 * on conflict rather than pre-checking (avoids a race). */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workspace"
  );
}
