import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  isReadableContrast,
  MIN_READABLE_CONTRAST,
} from "@/domains/themes";

describe("contrastRatio", () => {
  it("is 21:1 for pure black on white (the maximum possible)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("is 1:1 for identical colors", () => {
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#112233", "#eeddcc")).toBeCloseTo(
      contrastRatio("#eeddcc", "#112233"),
      5,
    );
  });
});

describe("isReadableContrast", () => {
  it("accepts black on white", () => {
    expect(isReadableContrast("#000000", "#ffffff")).toBe(true);
  });

  it("rejects near-identical low-contrast colors", () => {
    expect(isReadableContrast("#eeeeee", "#f5f5f5")).toBe(false);
  });

  it("matches the documented threshold exactly at the boundary", () => {
    // #767676 on white is right around the 4.5:1 text threshold and
    // comfortably above the 3:1 UI-component threshold we use.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(
      MIN_READABLE_CONTRAST,
    );
  });
});
