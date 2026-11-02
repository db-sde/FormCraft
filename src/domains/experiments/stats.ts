/** A/B test statistics, shared by the cross-form test (P3.9) and in-form
 * variants (F-29); safe to load in the browser. */

export type Arm = "a" | "b";

/** Starts each arm needs before a difference is reported. */
export const MIN_STARTS_PER_ARM = 100;
/** Two-sided significance level. */
export const SIGNIFICANCE = 0.05;

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
