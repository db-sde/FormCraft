import { describe, expect, it, vi } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";
import { buildSlackMessage, isSlackWebhookUrl } from "@/domains/webhooks/slack";
import { buildPopupSnippet } from "@/domains/forms/embed";
import { safeTrackingIds } from "@/app/f/[slug]/tracking-scripts";

vi.mock("server-only", () => ({}));

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Signup <b>" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    { id: "name", type: "short_text", order: 0, label: "Name", settings: {} },
    { id: "email", type: "email", order: 1, label: "Email", settings: {} },
    {
      id: "cv",
      type: "file_upload",
      order: 2,
      label: "CV",
      settings: { acceptedMimeTypes: ["application/pdf"], maxSizeMb: 5 },
    },
  ],
  logic: [],
});

describe("Slack (P2.14)", () => {
  it("only accepts Slack's own webhook URLs", () => {
    expect(isSlackWebhookUrl("https://hooks.slack.com/services/T0/B0/xyz")).toBe(true);
    expect(isSlackWebhookUrl("https://hooks.slack.com.evil.example/services/x")).toBe(
      false,
    );
    expect(isSlackWebhookUrl("http://hooks.slack.com/services/T0/B0/xyz")).toBe(false);
  });

  it("formats chosen answers, escapes them, and never links a file", () => {
    const message = buildSlackMessage({
      formTitle: "Signup <b>",
      schema,
      answers: { name: "<@channel> Ada", cv: "upload-123", email: "a@b.co" },
      questionIds: ["name", "cv"],
      responseUrl: "https://app.example/forms/f/responses/r",
    });
    const text = JSON.stringify(message);
    expect(text).toContain("&lt;@channel&gt; Ada");
    expect(text).toContain("File uploaded (open the response to see it)");
    expect(text).not.toContain("upload-123");
    expect(text).not.toContain("a@b.co"); // not chosen
    expect(message.text).toBe("New response to Signup <b>");
  });
});

describe("tracking ids (P2.12)", () => {
  it("drop anything that isn't exactly an id", () => {
    expect(
      safeTrackingIds({ ga: "G-ABC123", gtm: "GTM-AB12CD", meta: "1234567890" }),
    ).toEqual({
      ga: "G-ABC123",
      gtm: "GTM-AB12CD",
      meta: "1234567890",
    });
    expect(
      safeTrackingIds({ ga: "G-1');alert(1)//", gtm: "GTM-x", meta: "12;drop" }),
    ).toEqual({ ga: null, gtm: null, meta: null });
  });
});

describe("popup embed (P2.23)", () => {
  it("can't be broken out of by the title or label", () => {
    const code = buildPopupSnippet({
      formUrl: "https://app.example/f/apply",
      formId: "f1",
      title: "</script><script>alert(1)</script>",
      mode: "popup",
      label: "Go",
      color: "red; background:url(x)",
    });
    expect(code.match(/<\/script>/g)).toHaveLength(1);
    expect(code).toContain("#1f1f1f"); // bad colour replaced
  });

  it("opens the form in an overlay and closes on Escape, returning focus", () => {
    const code = buildPopupSnippet({
      formUrl: "https://app.example/f/apply",
      formId: "f1",
      title: "Apply",
      mode: "popup",
      label: "Apply now",
      color: "#123456",
    });
    const js = code.replace(/^<script>/, "").replace(/<\/script>$/, "");
    new Function(js)();
    const host = document.querySelector('[data-formcraft-popup="f1"]')!;
    const root = host.shadowRoot!;
    const button = root.querySelector("button")!;
    expect(button.textContent).toBe("Apply now");
    button.focus();
    button.click();
    const iframe = root.querySelector("iframe")!;
    expect(iframe.src).toBe("https://app.example/f/apply?embed=1");
    expect(document.documentElement.style.overflow).toBe("hidden");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(root.querySelector("iframe")).toBeNull();
    expect(root.activeElement).toBe(button);
  });
});
