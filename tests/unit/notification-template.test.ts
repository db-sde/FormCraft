import { describe, expect, it } from "vitest";
import { buildResponseCompletedEmail } from "@/domains/notifications/template";

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
});
