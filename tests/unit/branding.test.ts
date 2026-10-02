import { describe, expect, it } from "vitest";
import { showsMadeWith } from "@/domains/forms/branding";

const ending = (showMadeWith?: boolean) => ({
  id: "e",
  title: "Thanks",
  isDefault: true,
  ...(showMadeWith === undefined ? {} : { showMadeWith }),
});

describe("the Made with FormCraft badge (P2.1)", () => {
  it("can only be switched off on a plan that allows it", () => {
    expect(showsMadeWith(ending(false), true)).toBe(false);
    expect(showsMadeWith(ending(false), false)).toBe(true);
  });

  it("shows by default either way", () => {
    expect(showsMadeWith(ending(), true)).toBe(true);
    expect(showsMadeWith(ending(true), false)).toBe(true);
  });
});
