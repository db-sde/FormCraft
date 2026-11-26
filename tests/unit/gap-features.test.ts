import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  renderTemplate,
  replyToAddress,
  type MergeContext,
} from "@/domains/email-templates/render";
import {
  EmailTemplate,
  defaultTemplate,
  unknownTags,
} from "@/domains/email-templates/schema";
import { FormSeo, defaultShareDescription } from "@/domains/forms/seo";
import { THEME_PRESETS, applyPreset, contrastRatio } from "@/domains/themes";
import { onPrimaryColor } from "@/components/runtime/stage-theme";
import { periodAmountMinor } from "@/domains/billing/checkout/config";
import { stripeState } from "@/domains/billing/checkout/stripe";
import { verifyWebhookSignature } from "@/domains/payments/razorpay";
import {
  parseGoogleFontsMetadata,
  scriptForLanguage,
} from "@/domains/themes/font-metadata";
import { findLibraryFont, libraryFonts } from "@/domains/themes/font-library";
import {
  PLAN_ENTITLEMENTS,
  PLAN_PRICES,
  PLAN_PRICES_INR,
} from "@/domains/billing/catalog";
import { themeForLink } from "@/domains/themes/variants";
import type { FormSchemaV1, ThemeV1 } from "@/domains/forms/schema/v1";

const ctx: MergeContext = {
  formTitle: "Event signup",
  responseId: "r1",
  submittedAt: "2026-11-26T10:00:00.000Z",
  answers: {
    name: "Ada",
    bad: '<script>alert(1)</script><a href="https://evil.example">x</a>',
    blank: "",
  },
  hidden: { src: "ad" },
  answerLines: [{ label: "Name", value: "Ada" }],
};
const opts = { accent: "#e05d36", ownerName: "Acme", footerReason: "Because." };
const tpl = (over: Partial<EmailTemplate> = {}): EmailTemplate =>
  EmailTemplate.parse({ ...defaultTemplate("confirmation"), ...over });

describe("email templates (developer spec item 2)", () => {
  it("keeps respondent text as text: no markup, no links", () => {
    const out = renderTemplate(
      tpl({
        blocks: [
          { type: "text", text: "Hi **{{answer:bad}}** [site](https://acme.test)" },
        ],
      }),
      ctx,
      opts,
    );
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain('href="https://evil.example"');
    expect(out.html).toContain("&lt;script&gt;");
    // The creator's own link and bold still work.
    expect(out.html).toContain('href="https://acme.test"');
    expect(out.html).toContain("<strong>");
  });

  it("removes line breaks from the subject after merging (no extra headers)", () => {
    const out = renderTemplate(
      tpl({ subject: "Hi {{answer:name}}" }),
      { ...ctx, answers: { name: "Ada\r\nBcc: victim@example.com" } },
      opts,
    );
    expect(out.subject).not.toMatch(/[\r\n]/);
    expect(out.subject).toBe("Hi Ada Bcc: victim@example.com");
  });

  it("uses the fallback for a blank answer", () => {
    const out = renderTemplate(
      tpl({ blocks: [{ type: "heading", text: 'Thanks, {{answer:blank | "there"}}!' }] }),
      ctx,
      opts,
    );
    expect(out.html).toContain("Thanks, there!");
    expect(out.text).toContain("THANKS, THERE!");
  });

  it("makes a plain-text version and names the sender in the footer", () => {
    const out = renderTemplate(
      tpl({ blocks: [{ type: "text", text: "- one\n- two" }, { type: "answers" }] }),
      ctx,
      opts,
    );
    expect(out.text).toContain("- one");
    expect(out.text).toContain("Name: Ada");
    expect(out.text).toContain("Sent by Acme via FormCraft.");
    expect(out.html).toContain("<ul");
    expect(out.html).toContain('role="presentation"');
  });

  it("refuses unknown merge tags, merge tags in links, and unsafe links", () => {
    expect(unknownTags("{{answer:q1}} {{nope}}")).toEqual(["{{nope}}"]);
    expect(
      EmailTemplate.safeParse({
        ...defaultTemplate("confirmation"),
        subject: "{{password}}",
      }).success,
    ).toBe(false);
    expect(
      EmailTemplate.safeParse({
        ...tpl(),
        blocks: [{ type: "button", label: "Go", url: "https://x.test/{{answer:q1}}" }],
      }).success,
    ).toBe(false);
    expect(
      EmailTemplate.safeParse({
        ...tpl(),
        blocks: [{ type: "button", label: "Go", url: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
  });

  it("limits a template to 10 images and 100 KB", () => {
    const images = Array.from({ length: 11 }, () => ({
      type: "image",
      url: "https://x.supabase.co/a.png",
      alt: "",
    }));
    expect(EmailTemplate.safeParse({ ...tpl(), blocks: images }).success).toBe(false);
    const big = Array.from({ length: 30 }, () => ({
      type: "text",
      text: "x".repeat(3900),
    }));
    expect(EmailTemplate.safeParse({ ...tpl(), blocks: big }).success).toBe(false);
  });

  it("falls back to the owner when a reply-to answer isn't an address", () => {
    const t = tpl({ replyTo: { mode: "answer", questionId: "name" } });
    expect(replyToAddress(t, ctx, "owner@acme.test")).toBe("owner@acme.test");
    expect(
      replyToAddress(
        t,
        { ...ctx, answers: { name: "ada@example.com" } },
        "owner@acme.test",
      ),
    ).toBe("ada@example.com");
  });
});

describe("link preview and SEO (developer spec item 1)", () => {
  it("refuses merge tags in share fields", () => {
    expect(FormSeo.safeParse({ title: "Hi {{name}}" }).success).toBe(false);
    expect(FormSeo.safeParse({ description: "{{answer:q1}}" }).success).toBe(false);
    expect(FormSeo.safeParse({ title: "Hi there" }).success).toBe(true);
  });

  it("uses the welcome screen's first line as the default description", () => {
    const schema = {
      meta: { title: "T", description: "From meta" },
      questions: [
        {
          id: "w",
          type: "welcome_screen",
          label: "Welcome",
          description: "\nFirst line here\nSecond",
        },
      ],
    } as unknown as FormSchemaV1;
    expect(defaultShareDescription(schema)).toBe("First line here");
  });
});

describe("themes (developer spec item 3)", () => {
  it("has 50+ presets, each with readable text and buttons (4.5:1)", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(50);
    for (const { id, theme } of THEME_PRESETS) {
      const t = theme as ThemeV1;
      expect(contrastRatio(t.textColor!, t.backgroundColor), id).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(onPrimaryColor(t), t.primaryColor), id).toBeGreaterThanOrEqual(
        4.5,
      );
      if (t.headingFont) expect(findLibraryFont(t.headingFont), id).not.toBeNull();
    }
    const groups = new Set(THEME_PRESETS.map((p) => p.group));
    expect([...groups].sort()).toEqual([
      "bold",
      "corporate",
      "dark",
      "industry",
      "minimal",
      "playful",
      "seasonal",
      "soft",
    ]);
  });

  it("copies a preset in, so a later preset change never alters a form", () => {
    const base = {
      primaryColor: "#000000",
      backgroundColor: "#ffffff",
      fontFamily: "inter",
      buttonStyle: "rounded",
      headingFont: "Lora",
      logoUrl: "https://x.test/l.png",
    } as ThemeV1;
    const preset = THEME_PRESETS.find((p) => !p.theme.headingFont)!;
    const applied = applyPreset(base, preset);
    expect(applied.headingFont).toBeUndefined();
    expect(applied.logoUrl).toBe(base.logoUrl);
    expect(applied.preset).toBe(preset.id);
    const snapshot = JSON.stringify(applied);
    (preset.theme as { primaryColor: string }).primaryColor = "#123456";
    expect(JSON.stringify(applied)).toBe(snapshot);
  });

  it("lets a link pick a built-in preset by id, and nothing else", () => {
    const schema = {
      theme: {
        primaryColor: "#000000",
        backgroundColor: "#ffffff",
        fontFamily: "inter",
        buttonStyle: "rounded",
      },
    } as unknown as FormSchemaV1;
    expect(themeForLink(schema, "midnight").preset).toBe("midnight");
    expect(themeForLink(schema, "not-a-theme")).toBe(schema.theme);
    expect(themeForLink(schema, "#ff0000")).toBe(schema.theme);
  });

  it("finds 1,700+ fonts, including Noto Sans Devanagari, by script", () => {
    expect(libraryFonts().length).toBeGreaterThanOrEqual(1700);
    const noto = findLibraryFont("Noto Sans Devanagari");
    expect(noto?.scripts).toContain("devanagari");
    expect(scriptForLanguage("hi")).toBe("devanagari");
    expect(scriptForLanguage("en-GB")).toBe("latin");
    const parsed = parseGoogleFontsMetadata(
      `)]}'\n${JSON.stringify({
        familyMetadataList: [
          {
            family: "Good Font",
            category: "Serif",
            subsets: ["latin"],
            fonts: { "400": {} },
            popularity: 2,
            isOpenSource: true,
          },
          {
            family: 'Bad"Font',
            category: "Serif",
            subsets: [],
            fonts: { "400": {} },
            popularity: 1,
          },
          {
            family: "Thin Only",
            category: "Serif",
            subsets: [],
            fonts: { "100": {} },
            popularity: 3,
          },
        ],
      })}`,
    );
    expect(parsed.map((f) => f.family)).toEqual(["Good Font"]);
  });
});

describe("checkout (Stripe and Razorpay)", () => {
  it("charges a month, or twelve months at the yearly price", () => {
    expect(periodAmountMinor(PLAN_PRICES.pro, "month")).toBe(4900);
    expect(periodAmountMinor(PLAN_PRICES.pro, "year")).toBe(39 * 12 * 100);
    expect(periodAmountMinor(PLAN_PRICES_INR.starter, "year")).toBe(1299 * 12 * 100);
  });

  it("reads a Stripe subscription only when it's one of ours", () => {
    expect(stripeState({ id: "sub_1", customer: "cus", status: "active" })).toBeNull();
    expect(
      stripeState({
        id: "sub_1",
        customer: "cus_1",
        status: "past_due",
        cancel_at_period_end: true,
        current_period_end: 1_800_000_000,
        metadata: { workspace_id: "w1", plan_id: "pro", interval: "year" },
      }),
    ).toMatchObject({
      workspaceId: "w1",
      planId: "pro",
      interval: "year",
      status: "past_due",
      cancelAtPeriodEnd: true,
      currency: "usd",
    });
  });

  it("accepts only correctly signed Razorpay webhooks", () => {
    const body = JSON.stringify({ event: "subscription.activated" });
    const good = createHmac("sha256", "whsecret").update(body).digest("hex");
    expect(verifyWebhookSignature(body, good, "whsecret")).toBe(true);
    expect(verifyWebhookSignature(body, good, "other")).toBe(false);
    expect(verifyWebhookSignature(`${body} `, good, "whsecret")).toBe(false);
  });

  it("publishes the doc's API limits from one config", () => {
    expect(
      ["free", "starter", "pro", "business"].map((id) => {
        const e = PLAN_ENTITLEMENTS[id as keyof typeof PLAN_ENTITLEMENTS];
        return [
          e.api_requests_per_minute,
          e.api_burst,
          e.api_requests_per_day,
          e.api_keys,
        ];
      }),
    ).toEqual([
      [60, 100, 5000, 2],
      [150, 1000, 50000, 5],
      [300, 10000, 250000, 25],
      [1000, 50000, null, null],
    ]);
  });
});
