import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/domains/audit";
import {
  deleteScimUser,
  getScimUser,
  readScimPatch,
  readScimUser,
  ScimError,
  toScimUser,
  updateScimUser,
} from "@/domains/identity/scim";
import { scimBase, scimBody, scimJson, withScim } from "../../shared";

type Params = { params: Promise<{ id: string }> };

async function userId(params: Params["params"]): Promise<string> {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    throw new ScimError(404, "User not found.");
  return id;
}

export async function GET(request: NextRequest, { params }: Params) {
  return withScim(request, async (workspaceId, admin) =>
    scimJson(
      toScimUser(
        await getScimUser(admin, workspaceId, await userId(params)),
        scimBase(request),
      ),
    ),
  );
}

async function change(
  request: NextRequest,
  params: Params["params"],
  read: (body: unknown) => Parameters<typeof updateScimUser>[3],
) {
  return withScim(request, async (workspaceId, admin) => {
    const id = await userId(params);
    const { row, removedMembers } = await updateScimUser(
      admin,
      workspaceId,
      id,
      read(await scimBody(request)),
    );
    if (removedMembers > 0) {
      await audit(admin, {
        workspaceId,
        actorId: null,
        action: "member.removed",
        target: { type: "scim_user", id },
        metadata: { via: "scim", reason: "deactivated" },
      });
    }
    return scimJson(toScimUser(row, scimBase(request)));
  });
}

/** PUT replaces the user; PATCH changes fields (usually `active`). */
export async function PUT(request: NextRequest, { params }: Params) {
  return change(request, params, (body) => readScimUser(body));
}

export async function PATCH(request: NextRequest, { params }: Params) {
  return change(request, params, readScimPatch);
}

/** DELETE removes them from the directory and from the workspace. */
export async function DELETE(request: NextRequest, { params }: Params) {
  return withScim(request, async (workspaceId, admin) => {
    const id = await userId(params);
    const { removedMembers } = await deleteScimUser(admin, workspaceId, id);
    await audit(admin, {
      workspaceId,
      actorId: null,
      action: "member.removed",
      target: { type: "scim_user", id },
      metadata: { via: "scim", reason: "deleted", members: removedMembers },
    });
    return new NextResponse(null, { status: 204 });
  });
}
