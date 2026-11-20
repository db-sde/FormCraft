import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hitRateLimit } from "@/domains/abuse";
import { parseFormSchema } from "@/domains/forms/schema";
import {
  checkEmailCode,
  emailCodesAvailable,
  needsVerification,
  sendEmailCode,
} from "@/domains/verification/email-code";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody, writeDenied } from "../../shared";

/**
 * Email verification codes (roadmap #8). POST `{ questionId, email }`
 * emails a code; PUT `{ questionId, code }` checks one. Only the browser
 * that started the response may ask, the question must ask for
 * verification in the version this response was served, and codes are
 * limited per IP and per address on top of the per-question limits.
 */
const QuestionId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Send = z.object({ questionId: QuestionId, email: z.string().max(254) });
const Check = z.object({ questionId: QuestionId, code: z.string().max(20) });

async function emailQuestion(
  admin: ReturnType<typeof createAdminClient>,
  responseId: string,
  questionId: string,
) {
  const { data: response } = await admin
    .from("responses")
    .select("status, form_version_id")
    .eq("id", responseId)
    .maybeSingle();
  if (!response) return { error: apiError("not_found", "Response not found.", 404) };
  if (response.status === "completed") {
    return {
      error: apiError("already_submitted", "This response was already submitted.", 409),
    };
  }
  const { data: version } = await admin
    .from("form_versions")
    .select("schema")
    .eq("id", response.form_version_id)
    .single();
  const schema = parseFormSchema(version!.schema);
  const question = schema.questions.find((q) => q.id === questionId);
  if (!question || !needsVerification(question)) {
    return { error: apiError("invalid_body", "This question doesn't need a code.", 400) };
  }
  return { question, title: schema.meta.title };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = Send.safeParse(await readJsonBody(request));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return apiError("invalid_body", "Invalid request.", 400);
  }
  if (!emailCodesAvailable()) {
    return apiError("not_configured", "Codes can't be sent right now.", 503);
  }
  const admin = createAdminClient();
  const denied = await writeDenied(request, admin, id);
  if (denied) return denied;
  const email = parsed.data.email.trim().toLowerCase();
  for (const [key, max] of [
    [`email-code:ip:${getClientIp(request)}`, 20],
    [`email-code:to:${email}`, 8],
  ] as const) {
    const limit = await hitRateLimit(admin, key, max, 60 * 60 * 1000);
    if (!limit.allowed) {
      return apiError("rate_limited", "Too many codes asked for. Try again later.", 429);
    }
  }
  const found = await emailQuestion(admin, id, parsed.data.questionId);
  if ("error" in found) return found.error;
  const result = await sendEmailCode(admin, {
    responseId: id,
    question: found.question,
    email: parsed.data.email,
    formTitle: found.title,
  });
  if (result.ok) return NextResponse.json({ sent: true });
  const status = result.code === "wait" || result.code === "too_many" ? 429 : 400;
  return NextResponse.json(
    {
      error: {
        code: result.code,
        message: result.message,
        ...(result.code === "wait"
          ? { retryAfterSeconds: result.retryAfterSeconds }
          : {}),
      },
    },
    { status: result.code === "failed" ? 502 : status },
  );
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = Check.safeParse(await readJsonBody(request));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return apiError("invalid_body", "Invalid request.", 400);
  }
  const admin = createAdminClient();
  const denied = await writeDenied(request, admin, id);
  if (denied) return denied;
  const limit = await hitRateLimit(
    admin,
    `email-code-check:${getClientIp(request)}`,
    60,
    60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return apiError("rate_limited", "Too many tries. Try again later.", 429);
  }
  const found = await emailQuestion(admin, id, parsed.data.questionId);
  if ("error" in found) return found.error;
  const result = await checkEmailCode(admin, {
    responseId: id,
    questionId: parsed.data.questionId,
    code: parsed.data.code,
  });
  if (!result.ok) return apiError("wrong_code", result.message, 400);
  return NextResponse.json({ verified: true, email: result.email });
}
