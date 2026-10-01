import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { getHealthReport } from "@/domains/observability";

/**
 * The health report against a real database: rows that are late really
 * show up as overdue, and rows that are merely waiting their turn don't.
 * Other test files write to the same tables at the same time, so these
 * compare before/after instead of expecting absolute numbers.
 */
const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

let userId: string;
let workspaceId: string;
let endpointId: string;
let responseId: string;

beforeAll(async () => {
  const { data: user, error } = await admin.auth.admin.createUser({
    email: `health-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  userId = user.user.id;
  const { data: workspace } = await admin
    .from("workspaces")
    .insert({ name: "Health", slug: `health-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = workspace!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Health",
      slug: `health-form-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  const { data: version } = await admin
    .from("form_versions")
    .insert({
      form_id: form!.id,
      status: "draft",
      version_number: 1,
      schema: {
        schemaVersion: 1,
        meta: { title: "Health" },
        theme: {},
        endings: [{ id: "e", title: "E", isDefault: true }],
        questions: [
          {
            id: "q",
            type: "short_text",
            order: 0,
            label: "Q",
            required: false,
            settings: {},
          },
        ],
        logic: [],
      } as unknown as Json,
    })
    .select("id")
    .single();
  const { data: endpoint } = await admin
    .from("webhook_endpoints")
    .insert({ form_id: form!.id, url: "https://example.com/hook", signing_secret: "s" })
    .select("id")
    .single();
  endpointId = endpoint!.id;
  const { data: response } = await admin
    .from("responses")
    .insert({ form_id: form!.id, form_version_id: version!.id })
    .select("id")
    .single();
  responseId = response!.id;
}, 30_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(userId);
});

async function addDelivery(status: "pending" | "failed" | "exhausted", nextAt: string) {
  const { error } = await admin.from("webhook_deliveries").insert({
    endpoint_id: endpointId,
    response_id: responseId,
    event_type: `test.${crypto.randomUUID()}`,
    payload: {},
    status,
    next_attempt_at: nextAt,
  });
  if (error) throw error;
}

describe("getHealthReport", () => {
  it("counts a retry that's long overdue, and how long it has waited", async () => {
    const before = await getHealthReport(admin);
    await addDelivery("failed", minutesAgo(90));
    const after = await getHealthReport(admin);

    expect(after.webhooks.overdue).toBeGreaterThanOrEqual(before.webhooks.overdue + 1);
    expect(after.webhooks.oldestOverdueMinutes).toBeGreaterThanOrEqual(89);
    expect(after.status).toBe("degraded");
  });

  it("ignores retries that are simply waiting their turn", async () => {
    const before = await getHealthReport(admin);
    await addDelivery("pending", minutesFromNow(30));
    await addDelivery("pending", minutesAgo(2)); // due, but the sweep hasn't come round yet
    const after = await getHealthReport(admin);
    expect(after.webhooks.overdue).toBe(before.webhooks.overdue);
  });

  it("reports jobs that gave up in the last day", async () => {
    const before = await getHealthReport(admin);
    await addDelivery("exhausted", minutesAgo(5));
    const after = await getHealthReport(admin);
    expect(after.webhooks.exhaustedLast24h).toBeGreaterThanOrEqual(
      before.webhooks.exhaustedLast24h + 1,
    );
  });
});
