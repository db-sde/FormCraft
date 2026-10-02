import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * A/B tests (PRD P3.9). A form's link (arm A) splits new visitors with a
 * second published form (arm B). Assignment is a hash of the experiment
 * and a first-party visitor id, so a visitor always gets the same arm
 * and nothing about it is stored per visitor. Results compare completion
 * rates; nothing is called a winner until both arms have enough starts
 * and the difference is unlikely to be chance — the creator picks the
 * winner, the system never switches traffic on its own.
 */

export type Arm = "a" | "b";

export { VISITOR_COOKIE, VISITOR_ID_PATTERN } from "./visitor";

/** Starts each arm needs before a difference is reported. */
export const MIN_STARTS_PER_ARM = 100;
/** Two-sided significance level. */
export const SIGNIFICANCE = 0.05;

export class ExperimentError extends Error {}

/** The arm a visitor sees: stable for a visitor and experiment. */
export function assignArm(experimentId: string, visitorId: string, split: number): Arm {
  const digest = createHash("sha256").update(`${experimentId}:${visitorId}`).digest();
  return digest.readUInt32BE(0) % 100 < split ? "b" : "a";
}

export type ArmStats = { started: number; completed: number; rate: number | null };

export type Verdict =
  | { kind: "collecting"; needed: number }
  | { kind: "no_difference"; pValue: number }
  | { kind: "leading"; arm: Arm; pValue: number };

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, error < 1.5e-7). */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Two-proportion z-test on completion rate, behind a minimum sample. */
export function compareArms(a: ArmStats, b: ArmStats): Verdict {
  const needed = Math.max(0, MIN_STARTS_PER_ARM - Math.min(a.started, b.started));
  if (needed > 0) return { kind: "collecting", needed };
  const pa = a.completed / a.started;
  const pb = b.completed / b.started;
  const pooled = (a.completed + b.completed) / (a.started + b.started);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.started + 1 / b.started));
  if (se === 0) return { kind: "no_difference", pValue: 1 };
  const z = (pb - pa) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  if (pValue >= SIGNIFICANCE) return { kind: "no_difference", pValue };
  return { kind: "leading", arm: pb > pa ? "b" : "a", pValue };
}

export type Experiment = {
  id: string;
  name: string;
  formId: string;
  variantFormId: string;
  variantTitle: string;
  split: number;
  status: "running" | "stopped";
  winner: Arm | null;
  startedAt: string;
  endedAt: string | null;
};

export type ExperimentResults = Experiment & {
  arms: Record<Arm, ArmStats>;
  verdict: Verdict;
};

const stats = (row?: { started: number; completed: number }): ArmStats => ({
  started: row?.started ?? 0,
  completed: row?.completed ?? 0,
  rate: row && row.started > 0 ? row.completed / row.started : null,
});

/** A form's tests (where it is arm A), newest first, with results. */
export async function listExperiments(
  supabase: Client,
  formId: string,
): Promise<ExperimentResults[]> {
  const { data, error } = await supabase
    .from("experiments")
    .select(
      "id, name, form_id, variant_form_id, split, status, winner, started_at, ended_at, variant:forms!experiments_variant_form_id_fkey(title)",
    )
    .eq("form_id", formId)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return Promise.all(
    (data ?? []).map(async (row) => {
      const { data: rows, error: statsError } = await supabase.rpc("experiment_stats", {
        target_experiment_id: row.id,
      });
      if (statsError) throw statsError;
      const byForm = new Map((rows ?? []).map((r) => [r.form_id, r]));
      const arms = {
        a: stats(byForm.get(row.form_id)),
        b: stats(byForm.get(row.variant_form_id)),
      };
      return {
        id: row.id,
        name: row.name,
        formId: row.form_id,
        variantFormId: row.variant_form_id,
        variantTitle: (row.variant as { title: string } | null)?.title ?? "Variant",
        split: row.split,
        status: row.status as Experiment["status"],
        winner: row.winner as Arm | null,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        arms,
        verdict: compareArms(arms.a, arms.b),
      };
    }),
  );
}

/** Starts a test. RLS limits this to members who can publish; the checks
 * here are the ones a policy can't express nicely. */
export async function createExperiment(
  supabase: Client,
  input: {
    workspaceId: string;
    formId: string;
    variantFormId: string;
    name: string;
    split: number;
    createdBy: string;
  },
): Promise<string> {
  if (input.formId === input.variantFormId)
    throw new ExperimentError("Pick a different form for version B.");
  if (!Number.isInteger(input.split) || input.split < 1 || input.split > 99)
    throw new ExperimentError("The split must be between 1% and 99%.");
  const name = input.name.trim();
  if (!name || name.length > 80) throw new ExperimentError("Give the test a name.");

  const { data: forms } = await supabase
    .from("forms")
    .select("id, workspace_id, deleted_at, form_versions(status)")
    .in("id", [input.formId, input.variantFormId]);
  const live = (id: string) =>
    (forms ?? []).find(
      (f) =>
        f.id === id &&
        f.workspace_id === input.workspaceId &&
        !f.deleted_at &&
        f.form_versions.some((v) => v.status === "published"),
    );
  if (!live(input.formId)) throw new ExperimentError("Publish this form first.");
  if (!live(input.variantFormId))
    throw new ExperimentError("Version B must be a published form in this workspace.");

  // No chains: neither form can already be in a running test.
  const { data: running } = await supabase
    .from("experiments")
    .select("id")
    .eq("status", "running")
    .or(
      `form_id.in.(${input.formId},${input.variantFormId}),variant_form_id.in.(${input.formId},${input.variantFormId})`,
    )
    .limit(1);
  if (running?.length)
    throw new ExperimentError("One of these forms is already in a running test.");

  const { data, error } = await supabase
    .from("experiments")
    .insert({
      workspace_id: input.workspaceId,
      form_id: input.formId,
      variant_form_id: input.variantFormId,
      name,
      split: input.split,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new ExperimentError("Couldn't start the test.");
  return data.id;
}

/** Ends a test; all traffic goes back to A. With B as the winner, B's
 * live content is copied into A's draft for the creator to review and
 * publish — nothing goes live without them. */
export async function stopExperiment(
  supabase: Client,
  experimentId: string,
  winner: Arm | null,
): Promise<{ copiedIntoDraft: boolean }> {
  const { data: experiment } = await supabase
    .from("experiments")
    .select("id, form_id, variant_form_id, status")
    .eq("id", experimentId)
    .maybeSingle();
  if (!experiment) throw new ExperimentError("That test isn't there.");
  if (experiment.status !== "running") throw new ExperimentError("It's already stopped.");

  const { data, error } = await supabase
    .from("experiments")
    .update({ status: "stopped", ended_at: new Date().toISOString(), winner })
    .eq("id", experimentId)
    .eq("status", "running")
    .select("id");
  if (error || !data?.length) throw new ExperimentError("Couldn't stop the test.");
  if (winner !== "b") return { copiedIntoDraft: false };

  const [{ data: source }, { data: draft }] = await Promise.all([
    supabase
      .from("form_versions")
      .select("schema")
      .eq("form_id", experiment.variant_form_id)
      .eq("status", "published")
      .maybeSingle(),
    supabase
      .from("form_versions")
      .select("id, revision")
      .eq("form_id", experiment.form_id)
      .eq("status", "draft")
      .maybeSingle(),
  ]);
  if (!source || !draft) return { copiedIntoDraft: false };
  const { data: updated } = await supabase
    .from("form_versions")
    .update({ schema: source.schema, revision: draft.revision + 1 })
    .eq("id", draft.id)
    .eq("revision", draft.revision)
    .select("id");
  return { copiedIntoDraft: !!updated?.length };
}

/** The running test on a form's link, if the plan allows tests. Read with
 * the service role on the public page. */
export async function runningExperimentFor(
  admin: Client,
  formId: string,
): Promise<{ id: string; variantFormId: string; split: number } | null> {
  const { data } = await admin
    .from("experiments")
    .select("id, variant_form_id, split")
    .eq("form_id", formId)
    .eq("status", "running")
    .maybeSingle();
  return data
    ? { id: data.id, variantFormId: data.variant_form_id, split: data.split }
    : null;
}

/** The experiment a new response is tagged with: only a running test
 * that this form is an arm of — whatever the browser claims. */
export async function experimentForResponse(
  admin: Client,
  experimentId: string | undefined,
  formId: string,
): Promise<string | null> {
  if (!experimentId) return null;
  const { data } = await admin
    .from("experiments")
    .select("id, form_id, variant_form_id")
    .eq("id", experimentId)
    .eq("status", "running")
    .maybeSingle();
  return data && (data.form_id === formId || data.variant_form_id === formId)
    ? data.id
    : null;
}
