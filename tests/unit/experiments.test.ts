import { describe, expect, it } from "vitest";
import { assignArm, compareArms, MIN_STARTS_PER_ARM } from "@/domains/experiments";

const arm = (started: number, completed: number) => ({
  started,
  completed,
  rate: started ? completed / started : null,
});

describe("A/B assignment", () => {
  it("is stable for a visitor and follows the split", () => {
    const exp = "8c1f6b0e-4c55-4a52-9d36-2a7f0c1e9b10";
    expect(assignArm(exp, "visitor-aaaaaaaaaaaa", 50)).toBe(
      assignArm(exp, "visitor-aaaaaaaaaaaa", 50),
    );
    let b = 0;
    for (let i = 0; i < 4000; i++)
      if (assignArm(exp, `visitor-${i}-xxxxxxxx`, 20) === "b") b++;
    expect(b / 4000).toBeGreaterThan(0.17);
    expect(b / 4000).toBeLessThan(0.23);
    // A different experiment shuffles visitors independently.
    const other = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    let same = 0;
    for (let i = 0; i < 1000; i++) {
      const v = `visitor-${i}-xxxxxxxx`;
      if (assignArm(exp, v, 50) === assignArm(other, v, 50)) same++;
    }
    expect(same).toBeGreaterThan(400);
    expect(same).toBeLessThan(600);
  });
});

describe("A/B verdict", () => {
  it("won't call anything before both arms have enough starts", () => {
    expect(compareArms(arm(500, 400), arm(40, 2))).toEqual({
      kind: "collecting",
      needed: MIN_STARTS_PER_ARM - 40,
    });
  });

  it("calls a clear difference, and not a small one", () => {
    const clear = compareArms(arm(400, 160), arm(400, 220));
    expect(clear).toMatchObject({ kind: "leading", arm: "b" });
    expect(clear.kind === "leading" && clear.pValue).toBeLessThan(0.001);

    const close = compareArms(arm(200, 100), arm(200, 108));
    expect(close.kind).toBe("no_difference");
    // 50% vs 54% with 200 each: z ≈ 0.80, p ≈ 0.42.
    expect(close.kind === "no_difference" && close.pValue).toBeCloseTo(0.42, 1);

    expect(compareArms(arm(150, 150), arm(150, 150))).toEqual({
      kind: "no_difference",
      pValue: 1,
    });
  });
});
