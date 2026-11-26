import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOC2_LONG, SOC2_SHORT, bannedClaimsIn } from "@/domains/marketing/claims";

describe("SOC 2 wording (developer spec item 6)", () => {
  it("catches the banned phrasings", () => {
    expect(bannedClaimsIn("FormCraft is SOC 2 compliant")).toHaveLength(1);
    expect(bannedClaimsIn("We are SOC2 certified.")).toHaveLength(1);
    expect(bannedClaimsIn("Ask for our SOC 2 report")).toHaveLength(1);
    expect(bannedClaimsIn("SOC 2 compliant forms")).toHaveLength(1);
  });

  it("allows the approved wording", () => {
    expect(bannedClaimsIn(SOC2_SHORT)).toEqual([]);
    expect(bannedClaimsIn(SOC2_LONG)).toEqual([]);
  });

  it("passes on the codebase as it is", () => {
    expect(() =>
      execFileSync("npx", ["tsx", "scripts/check-claims.ts"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("fails the check on a test string", () => {
    const dir = mkdtempSync(join(tmpdir(), "claims-"));
    const file = join(dir, "page.tsx");
    writeFileSync(file, "<p>FormCraft is SOC 2 compliant</p>\n");
    const script = `import { readFileSync } from "node:fs";
import { bannedClaimsIn } from "${process.cwd()}/src/domains/marketing/claims";
process.exit(bannedClaimsIn(readFileSync(${JSON.stringify(file)}, "utf8")).length ? 1 : 0);`;
    const runner = join(dir, "run.ts");
    writeFileSync(runner, script);
    expect(() => execFileSync("npx", ["tsx", runner], { stdio: "pipe" })).toThrow();
  });
});
