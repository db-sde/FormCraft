import type { NextRequest } from "next/server";
import { audit } from "@/domains/audit";
import {
  createScimUser,
  listScimUsers,
  parseScimFilter,
  SCIM_LIST_SCHEMA,
  SCIM_MAX_RESULTS,
  toScimUser,
} from "@/domains/identity/scim";
import { scimBase, scimBody, scimJson, withScim } from "../shared";

/** GET /Users — the directory, optionally `?filter=userName eq "…"`,
 * paged with `startIndex` (1-based) and `count`. */
export async function GET(request: NextRequest) {
  return withScim(request, async (workspaceId, admin) => {
    const params = request.nextUrl.searchParams;
    const startIndex = Math.max(1, Number(params.get("startIndex")) || 1);
    const requested = params.get("count");
    const count = Math.min(
      SCIM_MAX_RESULTS,
      Math.max(0, requested === null ? SCIM_MAX_RESULTS : Number(requested) || 0),
    );
    const { rows, total } = await listScimUsers(admin, workspaceId, {
      email: parseScimFilter(params.get("filter")),
      startIndex,
      count,
    });
    return scimJson({
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: rows.length,
      Resources: rows.map((row) => toScimUser(row, scimBase(request))),
    });
  });
}

/** POST /Users — lists someone as allowed to join (they become a member
 * when they first sign in with SSO). */
export async function POST(request: NextRequest) {
  return withScim(request, async (workspaceId, admin) => {
    const row = await createScimUser(admin, workspaceId, await scimBody(request));
    await audit(admin, {
      workspaceId,
      actorId: null,
      action: "member.invited",
      target: { type: "scim_user", id: row.id },
      metadata: { via: "scim" },
    });
    return scimJson(toScimUser(row, scimBase(request)), 201);
  });
}
