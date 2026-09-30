import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  recordUpload,
  ResponseNotFoundError,
  QuestionNotFoundError,
  UnsupportedFileTypeError,
  FileTooLargeError,
} from "@/domains/uploads";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp } from "../../../shared";

const idSchema = z.string().uuid();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  const { id, questionId } = await params;
  if (!idSchema.safeParse(id).success)
    return apiError("invalid_body", "Invalid response id.", 400);
  if (!questionId || questionId.length > 64) {
    return apiError("invalid_body", "Invalid question id.", 400);
  }

  const rateLimitKey = `uploads:${getClientIp(request)}:${id}`;
  const rateLimit = await hitRateLimit(
    createAdminClient(),
    rateLimitKey,
    30,
    10 * 60 * 1000,
  );
  if (!rateLimit.allowed) {
    return apiError("rate_limited", "Too many attempts. Please try again shortly.", 429);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return apiError("invalid_body", "Expected multipart/form-data.", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return apiError("invalid_body", "Missing file.", 400);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const admin = createAdminClient();
    const result = await recordUpload(admin, id, questionId, {
      bytes,
      originalFilename: file.name || "upload",
    });
    return NextResponse.json({ uploadId: result.uploadId });
  } catch (error) {
    if (error instanceof ResponseNotFoundError) {
      return apiError("not_found", "Response not found.", 404);
    }
    if (error instanceof QuestionNotFoundError) {
      return apiError("invalid_body", "Invalid question for this form.", 400);
    }
    if (error instanceof UnsupportedFileTypeError) {
      return apiError("unsupported_type", "This file type isn't supported.", 400);
    }
    if (error instanceof FileTooLargeError) {
      return apiError("too_large", error.message, 413);
    }
    return apiError("unknown", "Upload failed. Please try again.", 500);
  }
}
