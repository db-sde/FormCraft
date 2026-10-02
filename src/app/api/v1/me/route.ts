import { NextResponse, type NextRequest } from "next/server";
import { withApiKey } from "../shared";

/** Checks a key (Zapier's "test connection"): which workspace it's for. */
export async function GET(request: NextRequest) {
  return withApiKey(request, "forms:read", async (caller, admin) => {
    const { data } = await admin
      .from("workspaces")
      .select("id, name")
      .eq("id", caller.workspaceId)
      .single();
    return NextResponse.json({ workspace: data });
  });
}
