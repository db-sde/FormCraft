import { describe, expect, it } from "vitest";
import { buildResponseCompletedEmail } from "@/domains/notifications/template";
import { renderEmailHtml } from "@/domains/notifications/email-layout";

describe("buildResponseCompletedEmail", () => {
  it("includes the form title and a link to the dashboard", () => {
    const email = buildResponseCompletedEmail({
      formTitle: "Customer Feedback",
      submittedAt: "2026-01-01T12:00:00.000Z",
      dashboardUrl: "https://example.com/forms/abc/responses/xyz",
    });
    expect(email.subject).toContain("Customer Feedback");
    expect(email.html).toContain("https://example.com/forms/abc/responses/xyz");
    expect(email.text).toContain("https://example.com/forms/abc/responses/xyz");
  });

  it("escapes a form title containing HTML so it can't inject markup into the email", () => {
    const email = buildResponseCompletedEmail({
      formTitle: "<img src=x onerror=alert(1)>",
      submittedAt: "2026-01-01T12:00:00.000Z",
      dashboardUrl: "https://example.com/forms/abc/responses/xyz",
    });
    expect(email.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(email.html).toContain("&lt;img");
  });

  it("falls back to a generic title for an empty form title", () => {
    const email = buildResponseCompletedEmail({
      formTitle: "",
      submittedAt: "2026-01-01T12:00:00.000Z",
      dashboardUrl: "https://example.com",
    });
    expect(email.subject).toContain("Untitled form");
  });

  it("links to the notification settings and names the recipient", () => {
    const email = buildResponseCompletedEmail({
      formTitle: "Feedback",
      submittedAt: "2026-09-30T13:32:00.000Z",
      dashboardUrl: "https://example.com/forms/abc/responses/xyz",
      settingsUrl: "https://example.com/forms/abc/integrations",
      recipient: "owner@example.com",
    });
    expect(email.html).toContain("https://example.com/forms/abc/integrations");
    expect(email.html).toContain("Sent to owner@example.com.");
    expect(email.text).toContain("Received: Sep 30, 2026 · 13:32 UTC");
    expect(email.text).toContain("Change it: https://example.com/forms/abc/integrations");
  });
});

describe("renderEmailHtml", () => {
  it("leaves template placeholders unescaped only when marked raw", () => {
    const base = {
      tag: "t",
      tagColor: "#fff",
      title: "Title",
      body: "Body",
      fine: "Fine",
      button: { label: "Go", href: "{{ .ConfirmationURL }}" },
    };
    expect(renderEmailHtml({ ...base, raw: { buttonHref: true } })).toContain(
      'href="{{ .ConfirmationURL }}"',
    );
    expect(renderEmailHtml(base)).toContain('href="{{ .ConfirmationURL }}"');
    expect(
      renderEmailHtml({ ...base, button: { label: "Go", href: 'x" onclick="y' } }),
    ).not.toContain('onclick="y');
  });
});
