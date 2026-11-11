import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getUploadSignedUrl } from "@/domains/uploads/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * A lasting link to one uploaded file or signature, for the CSV and Excel
 * exports (QA FC4-17). Opening it needs a signed-in member of the form's
 * workspace: the upload row is read with the caller's own session, so
 * row-level security decides, and the file is then served through a
 * short-lived signed download URL.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  const { uploadId } = await params;
  if (!z.string().uuid().safeParse(uploadId).success) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(
        `/login?next=${encodeURIComponent(`/api/uploads/${uploadId}`)}`,
        _request.url,
      ),
    );
  }
  const { data: upload } = await supabase
    .from("uploads")
    .select("storage_path, original_filename")
    .eq("id", uploadId)
    .maybeSingle();
  if (!upload) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  const url = await getUploadSignedUrl(
    supabase,
    upload.storage_path,
    300,
    upload.original_filename || "upload",
  );
  if (!url) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  return NextResponse.redirect(url);
}
