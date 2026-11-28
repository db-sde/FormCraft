import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENTS } from "@/domains/billing/catalog";
import { notOnPlanMessage } from "@/domains/billing/entitlements";
import {
  draftPlanWarning,
  planIssues,
  publishBlockedBy,
} from "@/domains/billing/schema-features";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

/**
 * The central plan check (QA run 15): one list of what a form uses that
 * its plan lacks, refused at publish and warned about on save.
 */
const free = PLAN_ENTITLEMENTS.free;
const starter = PLAN_ENTITLEMENTS.starter;
const pro = PLAN_ENTITLEMENTS.pro;

function form(questions: unknown[], extra: Record<string, unknown> = {}): FormSchemaV1 {
  return {
    schemaVersion: 1,
    meta: { title: "Plan check" },
    theme: {},
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions,
    logic: [],
    ...extra,
  } as unknown as FormSchemaV1;
}

const followUp = {
  id: "q1",
  type: "long_text",
  order: 0,
  label: "Tell us more",
  required: false,
  settings: { aiFollowUp: true },
};
const media = (maxSeconds: number) => ({
  id: "q2",
  type: "media",
  order: 1,
  label: "Say hello",
  required: false,
  settings: { kind: "audio", maxSeconds },
});

describe("central plan check", () => {
  it("refuses AI follow-ups on Free, not on Starter (FC15-37)", () => {
    const schema = form([followUp]);
    expect(planIssues(schema, free).map((i) => i.label)).toEqual([
      "AI follow-up questions",
    ]);
    expect(publishBlockedBy(schema, free)).toBe(
      "This form uses AI follow-up questions, which aren't included in your plan. Available on Starter and up. Remove it or upgrade to publish.",
    );
    expect(planIssues(schema, starter)).toEqual([]);
  });

  it("caps recordings at the plan's length and names the plan that allows it (FC15-38)", () => {
    expect(planIssues(form([media(60)]), free)).toEqual([]);
    const fiveMinutes = planIssues(form([media(300)]), free);
    expect(fiveMinutes).toEqual([
      expect.objectContaining({
        label: "Video and audio answers longer than 1 min",
        hint: "Available on Pro and up.",
      }),
    ]);
    expect(planIssues(form([media(120)]), free)[0].hint).toBe(
      "Available on Starter and up.",
    );
    expect(planIssues(form([media(300)]), pro)).toEqual([]);
  });

  it("names only Custom CSS when no font was uploaded (FC15-49)", () => {
    const css = form([], { theme: { customCss: "body{background:red}" } });
    expect(publishBlockedBy(css, free)).toMatch(
      /^This form uses Custom CSS, which isn't/,
    );
    expect(publishBlockedBy(css, free)).not.toMatch(/fonts/);
    const both = form([], {
      theme: {
        customCss: "body{background:red}",
        customFont: { name: "Mine", url: "https://x.test/f.woff2" },
      },
    });
    expect(publishBlockedBy(both, free)).toMatch(
      /^This form uses Custom CSS and Uploaded fonts, which aren't included/,
    );
  });

  it("lists everything at once, and warns on save without refusing", () => {
    const schema = form([followUp, media(300)], {
      pools: [{ id: "p", questionIds: ["q1"], ask: 1 }],
    });
    const labels = planIssues(schema, free).map((i) => i.label);
    expect(labels).toEqual([
      "Random groups, adaptive and progressive questions",
      "AI follow-up questions",
      "Video and audio answers longer than 1 min",
    ]);
    expect(draftPlanWarning(schema, free)).toMatch(
      /You can keep editing, but they must be removed, or the plan upgraded, before you publish\.$/,
    );
    expect(draftPlanWarning(form([followUp]), starter)).toBeNull();
  });
});

describe("gate messages read correctly (FC15-14, FC15-57, FC15-62)", () => {
  it("uses isn't for singular names and aren't for plural ones", () => {
    expect(notOnPlanMessage("auto_deletion")).toMatch(
      /^Automatic deletion of old responses isn't/,
    );
    expect(notOnPlanMessage("submission_editing")).toMatch(
      /^Editing submitted answers isn't/,
    );
    expect(notOnPlanMessage("embed_controls")).toMatch(
      /^Embed allowlist and kiosk mode aren't/,
    );
    expect(notOnPlanMessage("ab_testing")).toMatch(/^A\/B tests aren't/);
    expect(notOnPlanMessage("folders")).toMatch(/^Folders aren't/);
  });
});
