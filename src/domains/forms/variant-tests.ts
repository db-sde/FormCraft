import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { compareArms, type ArmStats, type Verdict } from "@/domains/experiments/stats";
import { ORIGINAL } from "./variants";

type Client = SupabaseClient<Database>;

/**
 * Variant tests (F-29): one open test per form, splitting new visitors
 * between the original and one variant of the published version.
 * Results compare completion rates with the same rule as the cross-form
 * A/B test (95% confidence, at least 100 starts per arm — the product
 * owner's choice, 2026-10-31); a winner is only ever recommended.
 */

export type VariantTest = {
  id: string;
  formId: string;
  variantId: string;
  name: string;
  split: number;
  status: "running" | "paused" | "ended";
  winner: string | null;
  startedAt: string;
  endedAt: string | null;
};

const COLUMNS =
  "id, form_id, variant_id, name, split, status, winner, started_at, ended_at";

function toTest(row: {
  id: string;
  form_id: string;
  variant_id: string;
  name: string;
  split: number;
  status: "running" | "paused" | "ended";
  winner: string | null;
  started_at: string;
  ended_at: string | null;
}): VariantTest {
  return {
    id: row.id,
    formId: row.form_id,
    variantId: row.variant_id,
    name: row.name,
    split: row.split,
    status: row.status,
    winner: row.winner,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

/** The form's running or paused test, if any. */
export async function openVariantTest(client: Client, formId: string) {
  const { data } = await client
    .from("variant_tests")
    .select(COLUMNS)
    .eq("form_id", formId)
    .neq("status", "ended")
    .maybeSingle();
  return data ? toTest(data) : null;
}

export async function listVariantTests(client: Client, formId: string) {
  const { data } = await client
    .from("variant_tests")
    .select(COLUMNS)
    .eq("form_id", formId)
    .order("started_at", { ascending: false })
    .limit(10);
  return (data ?? []).map(toTest);
}

export type VariantResults = {
  arms: Record<"original" | "variant", ArmStats>;
  verdict: Verdict;
};

/** Starts and completions per arm, counted from the responses each arm
 * served (so a paused test's later visitors, who aren't tagged, never
 * dilute it). Read as the caller. */
export async function variantResults(
  client: Client,
  test: VariantTest,
): Promise<VariantResults> {
  const count = async (arm: string, completed: boolean) => {
    let q = client
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("variant_test_id", test.id)
      .eq("variant", arm)
      .eq("is_preview", false);
    if (completed) q = q.eq("status", "completed");
    return (await q).count ?? 0;
  };
  const [os, oc, vs, vc] = await Promise.all([
    count(ORIGINAL, false),
    count(ORIGINAL, true),
    count(test.variantId, false),
    count(test.variantId, true),
  ]);
  const stats = (started: number, completed: number): ArmStats => ({
    started,
    completed,
    rate: started > 0 ? completed / started : null,
  });
  const original = stats(os, oc);
  const variant = stats(vs, vc);
  return { arms: { original, variant }, verdict: compareArms(original, variant) };
}

/** Whether a start may be tagged with this test and arm: the test is
 * this form's and running, and the arm is one of its two. */
export async function validVariantTag(
  admin: Client,
  formId: string,
  testId: string | undefined,
  variant: string | undefined,
): Promise<{ testId: string; variant: string } | null> {
  if (!testId || !variant) return null;
  const { data } = await admin
    .from("variant_tests")
    .select("form_id, variant_id, status")
    .eq("id", testId)
    .maybeSingle();
  if (!data || data.form_id !== formId || data.status !== "running") return null;
  if (variant !== ORIGINAL && variant !== data.variant_id) return null;
  return { testId, variant };
}
