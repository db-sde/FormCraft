import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { admin, canRunLocally, person, sql, url, type Person } from "./staff-helpers";

vi.mock("server-only", () => ({}));

/**
 * The developer spec's six features and checkout against the real
 * database (migrations 79–86): archiving, the API's token bucket, the
 * sitemap, billing state, email templates, feature switches and the font
 * catalogue.
 */
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const describeLocal = canRunLocally ? describe : describe.skip;
const anon = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false },
});

const schema = {
  schemaVersion: 1,
  meta: { title: "Gap" },
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

describeLocal("developer spec gap features", () => {
  let owner: Person;
  let viewer: Person;
  let workspaceId: string;
  let formId: string;
  let slug: string;

  async function newForm(name: string) {
    const s = `gap-${name}-${runId}`;
    const { data: form } = await admin
      .from("forms")
      .insert({ workspace_id: workspaceId, title: name, slug: s, created_by: owner.id })
      .select("id")
      .single();
    await admin
      .from("form_versions")
      .insert({ form_id: form!.id, status: "draft", version_number: 1, schema });
    await admin.rpc("publish_form_version", {
      target_form_id: form!.id,
      compiled_schema: schema,
    });
    return { id: form!.id, slug: s };
  }

  beforeAll(async () => {
    owner = await person("gap-owner", runId, { mfa: false });
    viewer = await person("gap-viewer", runId, { mfa: false });
    const { data: ws, error } = await owner.client.rpc("create_workspace_with_owner", {
      workspace_name: `Gap ${runId}`,
      workspace_slug: `gap-${runId}`,
    });
    if (error) throw error;
    workspaceId = ws.id;
    await admin
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: viewer.id, role: "viewer" });
    ({ id: formId, slug } = await newForm("main"));
  }, 60_000);

  afterAll(async () => {
    if (!canRunLocally) return;
    sql(`delete from private.ops_alerts where kind like 'feature_off:%';`);
    sql(`update public.feature_flags set enabled = true, reason = null;`);
    if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const p of [owner, viewer]) if (p) await admin.auth.admin.deleteUser(p.id);
  });

  describe("archiving (item 4)", () => {
    it("is refused to viewers", async () => {
      const { data } = await viewer.client.rpc("archive_form", { p_form_id: formId });
      expect(data).toEqual({ ok: false, code: "denied" });
    });

    it("asks about upcoming bookings, then unpublishes, cancels deliveries and stops tests", async () => {
      const { data: type } = await admin
        .from("booking_types")
        .insert({
          workspace_id: workspaceId,
          name: "Call",
          duration_minutes: 30,
          time_zone: "UTC",
        })
        .select("id")
        .single();
      const start = new Date(Date.now() + 86_400_000);
      const end = new Date(start.getTime() + 1_800_000);
      sql(`insert into public.bookings (booking_type_id, host_id, form_id, starts_at, ends_at, blocked,
             status, attendee_name, manage_token_hash)
           values ('${type!.id}', '${owner.id}', '${formId}', '${start.toISOString()}',
                   '${end.toISOString()}', tstzrange('${start.toISOString()}', '${end.toISOString()}'),
                   'confirmed', 'Grace', md5(random()::text));`);
      const { data: endpoint } = await admin
        .from("webhook_endpoints")
        .insert({
          form_id: formId,
          url: "https://hooks.example.com/x",
          signing_secret: "s",
        })
        .select("id")
        .single();
      const { data: response } = await admin
        .from("responses")
        .insert({
          form_id: formId,
          form_version_id: sql(
            `select id from public.form_versions where form_id = '${formId}' and status = 'published'`,
          ),
          status: "completed",
        } as never)
        .select("id")
        .single();
      await admin.from("webhook_deliveries").insert({
        endpoint_id: endpoint!.id,
        response_id: response!.id,
        event_type: "response.completed",
        payload: {},
      });
      const other = await newForm("variant");
      await admin.from("experiments").insert({
        workspace_id: workspaceId,
        form_id: formId,
        variant_form_id: other.id,
        name: "Test",
      });

      const first = await owner.client.rpc("archive_form", { p_form_id: formId });
      expect(first.data).toMatchObject({
        ok: false,
        code: "upcoming_bookings",
        count: 1,
      });
      const kept = await owner.client.rpc("archive_form", {
        p_form_id: formId,
        p_keep_bookings: true,
      });
      expect(kept.data).toMatchObject({ ok: true, cancelled: 1, kept_bookings: 1 });

      expect(
        sql(
          `select status || '|' || last_error from public.webhook_deliveries where endpoint_id = '${endpoint!.id}'`,
        ),
      ).toBe("exhausted|Not sent: the form was archived.");
      expect(
        sql(
          `select count(*) from public.form_versions where form_id = '${formId}' and status = 'published'`,
        ),
      ).toBe("0");
      expect(
        sql(`select status from public.experiments where form_id = '${formId}'`),
      ).toBe("stopped");
      expect((await anon.rpc("form_is_archived", { p_slug: slug })).data).toBe(true);
      // New responses are refused in the database too.
      const refused = await admin.from("responses").insert({ form_id: formId } as never);
      expect(refused.error).not.toBeNull();
    });

    it("restores the form unpublished, with the same slug", async () => {
      const { data } = await owner.client.rpc("restore_form", { p_form_id: formId });
      expect(data).toMatchObject({ ok: true });
      const { data: form } = await admin
        .from("forms")
        .select("slug, archived_at")
        .eq("id", formId)
        .single();
      expect(form).toEqual({ slug, archived_at: null });
      expect(
        sql(
          `select count(*) from public.form_versions where form_id = '${formId}' and status = 'published'`,
        ),
      ).toBe("0");
      expect((await anon.rpc("form_is_archived", { p_slug: slug })).data).toBe(false);
    });
  });

  describe("API limits (item 5)", () => {
    const take = (
      perMinute: number | null,
      burst: number | null,
      perDay: number | null,
    ) =>
      admin.rpc("api_take", {
        p_workspace_id: workspaceId,
        p_per_minute: perMinute as number,
        p_burst: burst as number,
        p_per_day: perDay as number,
      });

    it("holds the burst across 500 calls at once", async () => {
      sql(`delete from private.api_rate_buckets where workspace_id = '${workspaceId}';`);
      // 500 calls, 100 at a time (more open sockets than that fail on a
      // laptop, before reaching the database).
      const results = [];
      for (let wave = 0; wave < 5; wave += 1) {
        results.push(
          ...(await Promise.all(Array.from({ length: 100 }, () => take(1, 100, null)))),
        );
      }
      expect(results.filter((r) => r.error)).toEqual([]);
      const allowed = results.filter(
        (r) => (r.data as { allowed: boolean }).allowed,
      ).length;
      expect(allowed).toBe(100);
      const refused = results.find((r) => !(r.data as { allowed: boolean }).allowed)!
        .data as { scope: string; retry_after: number };
      expect(refused.scope).toBe("minute");
      expect(refused.retry_after).toBeGreaterThan(0);
    }, 60_000);

    it("stops at the daily cap with scope day, until 00:00 UTC", async () => {
      sql(`delete from private.api_rate_buckets where workspace_id = '${workspaceId}';`);
      for (let i = 0; i < 5; i += 1) {
        expect(((await take(600, 100, 5)).data as { allowed: boolean }).allowed).toBe(
          true,
        );
      }
      const sixth = (await take(600, 100, 5)).data as {
        allowed: boolean;
        scope: string;
        retry_after: number;
        daily_remaining: number;
        first_day_cap: boolean;
      };
      expect(sixth).toMatchObject({
        allowed: false,
        scope: "day",
        daily_remaining: 0,
        first_day_cap: true,
      });
      expect(sixth.retry_after).toBeLessThanOrEqual(86_400);
      // The owner is emailed once a day, not for every refusal.
      expect(
        ((await take(600, 100, 5)).data as { first_day_cap: boolean }).first_day_cap,
      ).toBe(false);
      sql(
        `update private.api_rate_buckets set day = day - 1 where workspace_id = '${workspaceId}';`,
      );
      expect(((await take(600, 100, 5)).data as { allowed: boolean }).allowed).toBe(true);
    });

    it("applies a bigger plan at once", async () => {
      sql(`delete from private.api_rate_buckets where workspace_id = '${workspaceId}';`);
      await Promise.all(Array.from({ length: 3 }, () => take(1, 2, null)));
      expect(((await take(1, 2, null)).data as { allowed: boolean }).allowed).toBe(false);
      await new Promise((r) => setTimeout(r, 100));
      // Pro-sized limits refill fast enough to allow the next request.
      expect(((await take(6000, 10000, null)).data as { allowed: boolean }).allowed).toBe(
        true,
      );
    });

    it("shows usage to owners and admins only", async () => {
      const own = (
        await owner.client.rpc("api_usage_summary", { p_workspace_id: workspaceId })
      ).data as {
        ok: boolean;
        hourly: { requests: number; limited: number }[];
        last_limited_at: string | null;
      };
      expect(own.ok).toBe(true);
      expect(own.hourly.reduce((n, h) => n + h.limited, 0)).toBeGreaterThan(0);
      expect(own.last_limited_at).not.toBeNull();
      const theirs = (
        await viewer.client.rpc("api_usage_summary", { p_workspace_id: workspaceId })
      ).data;
      expect(theirs).toEqual({ ok: false, code: "denied" });
    });
  });

  describe("sitemap (item 1)", () => {
    it("lists a form only when indexing is on, it's live and the plan has custom SEO", async () => {
      const f = await newForm("seo");
      await admin
        .from("forms")
        .update({ seo_live: { indexing: true } })
        .eq("id", f.id);
      const listed = async () =>
        ((await anon.rpc("sitemap_forms")).data ?? []).some((r) => r.slug === f.slug);
      expect(await listed()).toBe(false); // Free
      await admin.from("workspaces").update({ plan_id: "starter" }).eq("id", workspaceId);
      expect(await listed()).toBe(true);
      sql(
        `insert into public.form_access_secrets (form_id, password_hash) values ('${f.id}', 'x');`,
      );
      expect(await listed()).toBe(false); // password-protected
      sql(`delete from public.form_access_secrets where form_id = '${f.id}';`);
      await admin.from("workspaces").update({ plan_id: "free" }).eq("id", workspaceId);
    });
  });

  describe("billing (checkout)", () => {
    const apply = (status: string, planId = "pro", sub = `sub_${runId}`) =>
      admin.rpc("billing_apply_subscription", {
        p_workspace_id: workspaceId,
        p_provider: "stripe",
        p_subscription_id: sub,
        p_customer_id: "cus_x",
        p_plan_id: planId,
        p_interval: "year",
        p_currency: "usd",
        p_status: status,
        p_current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
        p_cancel_at_period_end: false,
      });
    const plan = async () =>
      (await admin.from("workspaces").select("plan_id").eq("id", workspaceId).single())
        .data!.plan_id;

    it("applies each provider event once", async () => {
      const claim = () =>
        admin.rpc("billing_claim_event", {
          p_provider: "stripe",
          p_event_id: `evt_${runId}`,
          p_type: "x",
        });
      expect((await claim()).data).toBe(true);
      expect((await claim()).data).toBe(false);
    });

    it("moves the plan with the subscription, and to Free when it ends", async () => {
      expect((await apply("pending")).data).toMatchObject({ plan_changed: false });
      expect(await plan()).toBe("free");
      expect((await apply("active")).data).toMatchObject({
        plan_changed: true,
        to: "pro",
      });
      expect(await plan()).toBe("pro");
      expect((await apply("past_due")).data).toMatchObject({ plan_changed: false });
      expect(await plan()).toBe("pro");
      expect((await apply("ended")).data).toMatchObject({
        plan_changed: true,
        to: "free",
      });
      expect(await plan()).toBe("free");
    });

    it("leaves a plan staff set by hand alone", async () => {
      await admin
        .from("workspaces")
        .update({ plan_id: "enterprise" })
        .eq("id", workspaceId);
      await apply("ended", "pro", `sub_old_${runId}`);
      expect(await plan()).toBe("enterprise");
      await admin.from("workspaces").update({ plan_id: "free" }).eq("id", workspaceId);
    });

    it("lets owners see the subscription, and nobody write it", async () => {
      const own = await owner.client
        .from("billing_subscriptions")
        .select("id")
        .eq("workspace_id", workspaceId);
      expect(own.data?.length).toBeGreaterThan(0);
      const theirs = await viewer.client
        .from("billing_subscriptions")
        .select("id")
        .eq("workspace_id", workspaceId);
      expect(theirs.data).toEqual([]);
      const write = await owner.client
        .from("billing_subscriptions")
        .update({ plan_id: "business" })
        .eq("workspace_id", workspaceId)
        .select("id");
      expect(write.data ?? []).toEqual([]);
      expect(
        (await owner.client.rpc("billing_apply_subscription" as never, {} as never))
          .error,
      ).not.toBeNull();
    });
  });

  describe("email templates (item 2)", () => {
    const row = (form: string) => ({
      workspace_id: workspaceId,
      kind: "confirmation",
      form_id: form,
      subject: "Thanks {{answer:q1}}",
      body: { blocks: [{ type: "text", text: "Hi" }] },
    });

    it("lets members who manage integrations save one, not viewers", async () => {
      expect(
        (await viewer.client.from("email_templates").insert(row(formId))).error,
      ).not.toBeNull();
      expect(
        (await owner.client.from("email_templates").insert(row(formId))).error,
      ).toBeNull();
      // One per form and kind.
      expect(
        (await owner.client.from("email_templates").insert(row(formId))).error,
      ).not.toBeNull();
    });

    it("refuses a form from another workspace", async () => {
      const { data: other } = await admin
        .from("forms")
        .insert({
          workspace_id: (
            await admin
              .from("workspaces")
              .insert({ name: "Other", slug: `gap-other-${runId}`, owner_id: viewer.id })
              .select("id")
              .single()
          ).data!.id,
          title: "Other",
          slug: `gap-otherform-${runId}`,
          created_by: viewer.id,
        })
        .select("id, workspace_id")
        .single();
      const res = await admin.from("email_templates").insert(row(other!.id));
      expect(res.error?.message).toContain("another workspace");
      await admin.from("workspaces").delete().eq("id", other!.workspace_id);
    });

    it("keeps a snapshot with each publish", async () => {
      const { data: v } = await admin
        .from("form_versions")
        .select("id")
        .eq("form_id", formId)
        .order("version_number", { ascending: false })
        .limit(1)
        .single();
      expect(
        (
          await admin.rpc("snapshot_email_templates", {
            p_form_id: formId,
            p_form_version_id: v!.id,
          })
        ).data,
      ).toBe(1);
      expect(
        sql(
          `select snapshot->>'subject' from public.email_template_versions where form_version_id = '${v!.id}'`,
        ),
      ).toBe("Thanks {{answer:q1}}");
    });
  });

  describe("feature switches", () => {
    it("start on, and a workspace override wins", async () => {
      const on = async (ws: string | null) =>
        (
          await admin.rpc("feature_enabled", {
            p_key: "email_templates",
            p_workspace_id: ws as string,
          })
        ).data;
      expect(await on(workspaceId)).toBe(true);
      await admin
        .from("feature_flag_overrides")
        .insert({ workspace_id: workspaceId, key: "email_templates", enabled: false });
      expect(await on(workspaceId)).toBe(false);
      expect(await on(null)).toBe(true);
    });

    it("can't be changed by customers", async () => {
      const { data } = await owner.client.rpc("admin_set_feature_flag", {
        p_key: "checkout",
        p_enabled: false,
        p_workspace_id: null as never,
        p_reason: "trying",
      });
      expect((data as { ok: boolean }).ok).toBe(false);
      expect(sql(`select enabled from public.feature_flags where key = 'checkout'`)).toBe(
        "t",
      );
    });
  });

  describe("font catalogue (item 3)", () => {
    it("has 1,700+ families anyone can read, and refuses a short import", async () => {
      expect(
        Number(sql("select count(*) from public.font_families")),
      ).toBeGreaterThanOrEqual(1700);
      const { data } = await anon
        .from("font_families")
        .select("family, scripts")
        .eq("family", "Noto Sans Devanagari")
        .single();
      expect(data?.scripts).toContain("devanagari");
      const short = await admin.rpc("ops_replace_font_families", {
        p_fonts: [] as unknown as Json,
      });
      expect(short.error).not.toBeNull();
    });
  });
});
