import { NextResponse, type NextRequest } from "next/server";
import {
  purgeDeletedForms,
  purgeExpiredCompletedResponses,
  purgeExpiredUnfinishedResponses,
} from "@/domains/responses";
import { pruneRateLimits } from "@/domains/abuse";
import { purgeStaleProfiles } from "@/domains/responses/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";
import type { Json } from "@/lib/supabase/database.types";

// A batch of background work: bounded explicitly (seconds).
export const maxDuration = 60;

type Admin = ReturnType<typeof createAdminClient>;

/** Runs one retention job and records it (Super Admin Phase 4: a failed
 * or missing run raises an alert). One job failing doesn't stop the rest. */
async function job(
  admin: Admin,
  name: string,
  work: () => Promise<Record<string, unknown>>,
): Promise<{ ok: boolean; counts: Record<string, unknown> }> {
  const started = Date.now();
  try {
    const counts = await work();
    await admin.rpc("ops_record_retention_run", {
      p_job: name,
      p_ok: true,
      p_counts: counts as Json,
      p_duration_ms: Date.now() - started,
    });
    return { ok: true, counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "retention_failed", job: name, message }));
    await admin.rpc("ops_record_retention_run", {
      p_job: name,
      p_ok: false,
      p_counts: {},
      p_error: message.slice(0, 500),
      p_duration_ms: Date.now() - started,
    });
    return { ok: false, counts: {} };
  }
}

/**
 * Daily sweep: unfinished responses past each form's retention period,
 * completed responses past the workspace's policy, deleted forms, stale
 * remembered answers, finished background work and old analytics events.
 * Protected by CRON_SECRET; GET for Vercel Cron, POST for other
 * schedulers.
 */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const admin = createAdminClient();
  const results = {
    unfinished_responses: await job(admin, "unfinished_responses", () =>
      purgeExpiredUnfinishedResponses(admin),
    ),
    completed_responses: await job(admin, "completed_responses", () =>
      purgeExpiredCompletedResponses(admin),
    ),
    deleted_forms: await job(admin, "deleted_forms", () => purgeDeletedForms(admin)),
    rate_limits: await job(admin, "rate_limits", async () => {
      await pruneRateLimits(admin);
      return {};
    }),
    // Finished background work past its keep period (migration 56).
    operational_data: await job(admin, "operational_data", async () => {
      const { data, error } = await admin.rpc("prune_operational_data", {});
      if (error) throw error;
      return { pruned: data };
    }),
    // Analytics events past 90 days become daily counts (migration 59).
    analytics_events: await job(admin, "analytics_events", async () => {
      let folded = 0;
      for (let i = 0; i < 20; i += 1) {
        const { data, error } = await admin.rpc("rollup_analytics_events", {});
        if (error) throw error;
        folded += data ?? 0;
        if (!data) break;
      }
      return { folded };
    }),
    remembered_answers: await job(admin, "remembered_answers", async () => ({
      deleted: await purgeStaleProfiles(admin),
    })),
    // The font library's catalogue, from Google once a month.
    font_families: await job(admin, "font_families", async () => {
      const { refreshFontFamilies } = await import("@/domains/themes/font-refresh");
      return refreshFontFamilies(admin);
    }),
    // API usage by the hour, past the 30 days Settings → API shows.
    api_usage: await job(admin, "api_usage", async () => {
      const { data, error } = await admin.rpc("ops_prune_api_usage");
      if (error) throw error;
      return { pruned: data };
    }),
  };
  const failed = Object.entries(results)
    .filter(([, r]) => !r.ok)
    .map(([name]) => name);
  return NextResponse.json(
    {
      ok: failed.length === 0,
      failed,
      ...Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.counts])),
    },
    { status: failed.length === 0 ? 200 : 500 },
  );
}

export const GET = run;
export const POST = run;
