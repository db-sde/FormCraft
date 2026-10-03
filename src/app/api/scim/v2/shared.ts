import { NextResponse, type NextRequest } from "next/server";
import { hitRateLimit } from "@/domains/abuse/shared-rate-limit";
import { authenticateScim, ScimError, SCIM_ERROR_SCHEMA } from "@/domains/identity/scim";
import { createAdminClient } from "@/lib/supabase/admin";

const SCIM_JSON = "application/scim+json";

export function scimJson(body: unknown, status = 200) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": SCIM_JSON },
  });
}

export function scimError(status: number, detail: string, scimType?: string) {
  return scimJson(
    {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(status),
      detail,
      ...(scimType ? { scimType } : {}),
    },
    status,
  );
}

/** Where this SCIM service lives, for `meta.location`. */
export function scimBase(request: NextRequest): string {
  return `${request.nextUrl.origin}/api/scim/v2`;
}

/**
 * The SCIM surface (P3.18): `Authorization: Bearer scim_…`, scoped to
 * the token's workspace, 300 requests a minute. Runs with the service
 * role, so every query filters by that workspace explicitly.
 */
export async function withScim(
  request: NextRequest,
  handler: (
    workspaceId: string,
    admin: ReturnType<typeof createAdminClient>,
  ) => Promise<Response>,
): Promise<Response> {
  const admin = createAdminClient();
  const workspaceId = await authenticateScim(admin, request.headers.get("authorization"));
  if (!workspaceId) return scimError(401, "A valid SCIM token is required.");
  if (!(await hitRateLimit(admin, `scim:${workspaceId}`, 300, 60_000)).allowed) {
    return scimError(429, "Too many requests.");
  }
  try {
    return await handler(workspaceId, admin);
  } catch (error) {
    if (error instanceof ScimError)
      return scimError(error.status, error.message, error.scimType);
    return scimError(500, "Something went wrong.");
  }
}

export async function scimBody(request: NextRequest): Promise<unknown> {
  try {
    const text = await request.text();
    if (text.length > 100_000) throw new ScimError(413, "Request body is too large.");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ScimError) throw error;
    throw new ScimError(400, "The body isn't valid JSON.", "invalidSyntax");
  }
}
