import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveConnection } from "@/domains/sheets";
import { admin, canRunLocally, person, type Person } from "./staff-helpers";

vi.mock("server-only", () => ({}));

/**
 * The OAuth callback stores the connection as the signed-in creator, not
 * with the service role. Members can't read the token column, and an
 * upsert needs to, so connecting Sheets failed with "exchange_failed"
 * in production (28 Nov 2026). This runs the save the way the callback does.
 */
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const describeLocal = canRunLocally ? describe : describe.skip;

describeLocal("Sheets connection saved as the signed-in owner", () => {
  let owner: Person;
  let workspaceId: string;
  let formId: string;

  beforeAll(async () => {
    owner = await person("sheets-owner", runId, { mfa: false });
    const { data: ws, error } = await owner.client.rpc("create_workspace_with_owner", {
      workspace_name: `Sheets ${runId}`,
      workspace_slug: `sheets-${runId}`,
    });
    if (error) throw error;
    workspaceId = ws.id;
    const { data: form } = await admin
      .from("forms")
      .insert({
        workspace_id: workspaceId,
        title: "S",
        slug: `s-${runId}`,
        created_by: owner.id,
      })
      .select("id")
      .single();
    formId = form!.id;
  }, 60_000);

  afterAll(async () => {
    if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
    if (owner) await admin.auth.admin.deleteUser(owner.id);
  });

  it("saves, then reconnects", async () => {
    const tokens = {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 3600_000,
    };
    await saveConnection(owner.client, workspaceId, formId, tokens);
    await saveConnection(owner.client, workspaceId, formId, {
      ...tokens,
      refreshToken: "r2",
    });
    const { count } = await admin
      .from("sheets_connections")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId);
    expect(count).toBe(1);
  });
});
