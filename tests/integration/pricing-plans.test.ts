import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { getWorkspacePlan } from "@/domains/billing";
import { PLAN_PRICES } from "@/domains/billing/catalog";
import { firstTimeThisMonth, quotaUsed, takeQuota } from "@/domains/billing/quotas";
import { publishBlockedBy } from "@/domains/billing/schema-features";
import { beginAi } from "@/domains/ai/gateway";
import { startResponse } from "@/domains/responses";
import { archiveForm, restoreForm } from "@/domains/forms/queries";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { admin, canRunLocally, person, sql, url, type Person } from "./staff-helpers";

vi.mock("server-only", () => ({}));

/**
 * The pricing doc's plans and quotas against the real database
 * (migrations 77 and 78): public prices, monthly quotas that stop at the
 * plan's number, upgrade requests to staff, archived forms refusing
 * responses, notifications held back by the email quota, and forms that
 * can't go live with a feature their plan lacks.
 */
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const describeLocal = canRunLocally ? describe : describe.skip;

const schema = {
  schemaVersion: 1,
  meta: { title: "Pricing" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Name",
      required: false,
      settings: {},
    },
  ],
  logic: [],
} as unknown as Json;

describeLocal("pricing plans and quotas", () => {
  let owner: Person;
  let stranger: Person;
  let workspaceId: string;
  let formId: string;

  beforeAll(async () => {
    owner = await person("price-owner", runId, { mfa: false });
    stranger = await person("price-stranger", runId, { mfa: false });
    const { data: ws, error } = await owner.client.rpc("create_workspace_with_owner", {
      workspace_name: `Pricing ${runId}`,
      workspace_slug: `pricing-${runId}`,
    });
    if (error) throw error;
    workspaceId = ws.id;
    const { data: form } = await admin
      .from("forms")
      .insert({
        workspace_id: workspaceId,
        title: "Pricing",
        slug: `pricing-${runId}`,
        created_by: owner.id,
      })
      .select("id")
      .single();
    formId = form!.id;
    await admin
      .from("form_versions")
      .insert({ form_id: formId, status: "draft", version_number: 1, schema });
    const { error: publishError } = await admin.rpc("publish_form_version", {
      target_form_id: formId,
      compiled_schema: schema,
    });
    if (publishError) throw publishError;
  }, 60_000);

  afterAll(async () => {
    if (!canRunLocally) return;
    if (workspaceId) {
      sql(`delete from private.ops_alerts where kind like 'upgrade_requested:%'
             and details->>'workspace_id' = '${workspaceId}';`);
      await admin.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const p of [owner, stranger]) if (p) await admin.auth.admin.deleteUser(p.id);
  });

  it("publishes the four public plans and their prices to anyone", async () => {
    const anon = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { data, error } = await anon.rpc("public_plans");
    expect(error).toBeNull();
    expect(data!.map((p) => p.id)).toEqual(["free", "starter", "pro", "business"]);
    for (const p of data!) {
      const price = PLAN_PRICES[p.id as keyof typeof PLAN_PRICES];
      expect(Number(p.monthly_usd)).toBe(price.monthly);
      expect(Number(p.annual_usd)).toBe(price.annual);
    }
  });

  it("starts on Free: no AI credits, 500 emails, and no AI form tools", async () => {
    const { planId, entitlements } = await getWorkspacePlan(admin, workspaceId);
    expect(planId).toBe("free");
    expect(entitlements.ai_credits_per_month).toBe(0);
    expect(entitlements.emails_per_month).toBe(500);
    expect(entitlements.address_lookups_per_month).toBe(0);
    const result = await beginAi(admin, {
      feature: "form_generate",
      workspaceId,
      entitlements,
    });
    expect(result).toMatchObject({ ok: false, code: "limited" });
  });

  it("stops a monthly quota at the plan's number, and counts past it when asked", async () => {
    await admin
      .from("workspaces")
      .update({ entitlement_overrides: { emails_per_month: 3 } })
      .eq("id", workspaceId);
    expect(await takeQuota(admin, workspaceId, "emails", 2)).toBe(true);
    // Two more would make four: refused whole, nothing taken.
    expect(await takeQuota(admin, workspaceId, "emails", 2)).toBe(false);
    expect(await quotaUsed(admin, workspaceId, "emails")).toBe(2);
    expect(await takeQuota(admin, workspaceId, "emails", 1)).toBe(true);
    expect(await takeQuota(admin, workspaceId, "emails", 1)).toBe(false);
    // Respondent-facing emails (verification codes) are counted, never refused.
    expect(await takeQuota(admin, workspaceId, "emails", 1, { countOnly: true })).toBe(
      true,
    );
    expect(await quotaUsed(admin, workspaceId, "emails")).toBe(4);
    await admin
      .from("workspaces")
      .update({ entitlement_overrides: {} })
      .eq("id", workspaceId);
  });

  it("warns once a month per threshold", async () => {
    expect(await firstTimeThisMonth(admin, workspaceId, "storage_80")).toBe(true);
    expect(await firstTimeThisMonth(admin, workspaceId, "storage_80")).toBe(false);
    expect(await firstTimeThisMonth(admin, workspaceId, "storage_95")).toBe(true);
  });

  it("measures storage for the server only", async () => {
    const { data, error } = await admin.rpc("workspace_storage_bytes", {
      p_workspace_id: workspaceId,
    });
    expect(error).toBeNull();
    expect(Number(data)).toBeGreaterThanOrEqual(0);
    const { error: denied } = await owner.client.rpc("workspace_storage_bytes", {
      p_workspace_id: workspaceId,
    });
    expect(denied).not.toBeNull();
  });

  it("sends an upgrade request to staff once a day, and settles it on a plan change", async () => {
    const ask = (p: Person, plan: string) =>
      p.client.rpc("request_plan_upgrade", {
        p_workspace_id: workspaceId,
        p_plan_id: plan,
        p_note: "We need more seats",
      });
    expect((await ask(stranger, "pro")).data).toEqual({ ok: false, code: "denied" });
    expect((await ask(owner, "enterprise")).data).toEqual({ ok: false, code: "invalid" });
    expect((await ask(owner, "pro")).data).toEqual({ ok: true });
    expect((await ask(owner, "business")).data).toEqual({
      ok: false,
      code: "already_requested",
    });
    expect(
      sql(`select count(*) from private.ops_alerts where kind like 'upgrade_requested:%'
             and details->>'workspace_id' = '${workspaceId}' and resolved_at is null;`),
    ).toBe("1");
    await admin.from("workspaces").update({ plan_id: "pro" }).eq("id", workspaceId);
    expect(
      sql(`select count(*) from private.upgrade_requests
            where workspace_id = '${workspaceId}' and handled_at is null;`),
    ).toBe("0");
    // Settled, so they can ask again.
    expect((await ask(owner, "business")).data).toEqual({ ok: true });
    await admin.from("workspaces").update({ plan_id: "free" }).eq("id", workspaceId);
  });

  it("holds back notifications by day and form, claimed once after the day ends", async () => {
    for (let i = 0; i < 2; i += 1) {
      await admin.rpc("ops_defer_notification", {
        p_workspace_id: workspaceId,
        p_form_id: formId,
      });
    }
    expect(
      sql(`select responses from private.deferred_notifications
            where workspace_id = '${workspaceId}';`),
    ).toBe("2");
    // Today's aren't claimed yet; yesterday's are, once.
    sql(`update private.deferred_notifications set day = day - 1
          where workspace_id = '${workspaceId}';`);
    const first = await admin.rpc("ops_claim_deferred_notifications");
    expect(first.data!.filter((r) => r.workspace_id === workspaceId)).toEqual([
      expect.objectContaining({ form_id: formId, responses: 2 }),
    ]);
    const second = await admin.rpc("ops_claim_deferred_notifications");
    expect(second.data!.filter((r) => r.workspace_id === workspaceId)).toEqual([]);
    const { error } = await owner.client.rpc("ops_defer_notification", {
      p_workspace_id: workspaceId,
      p_form_id: formId,
    });
    expect(error).not.toBeNull();
  });

  it("refuses new responses on an archived form; restored, it's unpublished until published again", async () => {
    expect(await archiveForm(owner.client, formId)).toMatchObject({ ok: true });
    await expect(startResponse(admin, formId)).rejects.toThrow();
    expect(await restoreForm(owner.client, formId)).toMatchObject({ ok: true });
    await expect(startResponse(admin, formId)).rejects.toThrow();
    await admin.rpc("publish_form_version", {
      target_form_id: formId,
      compiled_schema: schema,
    });
    const started = await startResponse(admin, formId);
    expect(started.responseId).toBeTruthy();
  });

  it("won't publish a form using a feature the plan lacks", async () => {
    const withTest = {
      ...(schema as object),
      variants: [{ id: "a", name: "A", weight: 50 }],
    } as unknown as FormSchemaV1;
    const free = (await getWorkspacePlan(admin, workspaceId)).entitlements;
    expect(publishBlockedBy(withTest, free)).toMatch(/A\/B tests, which aren't included/);
    expect(publishBlockedBy(withTest, { ...free, ab_testing: true })).toBeNull();
  });
});
