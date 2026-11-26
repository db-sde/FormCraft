import { NextResponse } from "next/server";
import { SWITCHED_OFF, featureEnabled } from "@/domains/flags";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { hasPermission } from "@/domains/workspaces/permissions";
import { canEdit } from "@/domains/workspaces";
import { planBlocks } from "@/domains/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/domains/abuse/limit";
import {
  processFavicon,
  processShareImage,
  ShareAssetError,
  type Crop,
} from "@/domains/forms/share-assets";

const CropInput = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});

/**
 * Uploads a share image or a tab icon for a form's link preview
 * (developer spec item 1; Starter and up). The file is re-encoded on the
 * server (EXIF and location dropped, share images cropped to 1200 × 630)
 * and stored in the public share-assets bucket. Returns its URL; the
 * creator then saves it with the other settings.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: formId } = await params;
  if (!z.string().uuid().safeParse(formId).success) {
    return NextResponse.json({ message: "Form not found." }, { status: 404 });
  }
  const { supabase, workspace } = await getCurrentWorkspace();
  if (
    !canEdit(workspace.role) ||
    !(await hasPermission(supabase, workspace.id, "publish"))
  ) {
    return NextResponse.json({ message: "You can't change this form." }, { status: 403 });
  }
  const { data: form } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!form) return NextResponse.json({ message: "Form not found." }, { status: 404 });
  const blocked = await planBlocks(supabase, workspace.id, "custom_seo");
  if (blocked) {
    return NextResponse.json(
      { code: "plan_required", message: blocked },
      { status: 403 },
    );
  }
  if (!(await featureEnabled("link_preview_seo", workspace.id))) {
    return NextResponse.json({ message: SWITCHED_OFF }, { status: 503 });
  }
  if (!(await rateLimit(`seo-asset:${workspace.id}`, 30, 3_600_000)).allowed) {
    return NextResponse.json(
      { message: "Too many uploads. Try again later." },
      { status: 429 },
    );
  }

  const data = await request.formData().catch(() => null);
  const file = data?.get("file");
  const kind = data?.get("kind");
  if (!(file instanceof File) || (kind !== "image" && kind !== "favicon")) {
    return NextResponse.json({ message: "Choose a file." }, { status: 400 });
  }
  let crop: Crop | null = null;
  const rawCrop = data?.get("crop");
  if (typeof rawCrop === "string" && rawCrop) {
    let json: unknown = null;
    try {
      json = JSON.parse(rawCrop);
    } catch {
      json = null;
    }
    const parsed = CropInput.safeParse(json);
    if (!parsed.success)
      return NextResponse.json({ message: "Bad crop." }, { status: 400 });
    crop = parsed.data;
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const folder = `${workspace.id}/${formId}`;
    const admin = createAdminClient();
    const url =
      kind === "image"
        ? await processShareImage(admin, folder, bytes, crop)
        : await processFavicon(admin, folder, bytes);
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof ShareAssetError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    return NextResponse.json({ message: "Couldn't use that file." }, { status: 400 });
  }
}
