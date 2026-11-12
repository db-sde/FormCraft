import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isWriteSecretFor, writeSecretCookie } from "@/domains/responses/write-secret";
import { apiError, readJsonBody } from "../../shared";

const Body = z.object({ secret: z.string().min(1).max(100) });

/**
 * A resume link opened in another browser (QA FC4-14): the page, which
 * checked the link, hands the response's write secret to the browser,
 * and this sets it as the response's cookie, so saving and submitting
 * work there too. Without the right secret it does nothing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = Body.safeParse(await readJsonBody(request));
  if (!z.string().uuid().safeParse(id).success || !parsed.success)
    return apiError("invalid_body", "Invalid request.", 400);
  if (!isWriteSecretFor(id, parsed.data.secret))
    return apiError("forbidden", "That isn't this response's secret.", 403);
  const response = new NextResponse(null, { status: 204 });
  const cookie = writeSecretCookie(id, request.nextUrl.protocol === "https:");
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
