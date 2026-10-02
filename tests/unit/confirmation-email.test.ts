import { describe, expect, it, vi } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";

vi.mock("server-only", () => ({}));

const { buildConfirmationEmail, recipientFrom, DEFAULT_CONFIRMATION, emailQuestions } =
  await import("@/domains/notifications/confirmation");

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Event" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    { id: "name", type: "short_text", order: 0, label: "Name", settings: {} },
    {
      id: "contact",
      type: "contact_info",
      order: 1,
      label: "Contact",
      settings: { fields: ["name", "email"], requiredFields: ["email"] },
    },
  ],
  logic: [],
});

describe("confirmation emails (P2.18)", () => {
  it("go only to a valid address from the chosen question", () => {
    const contact = schema.questions[1];
    expect(emailQuestions(schema).map((q) => q.id)).toEqual(["contact"]);
    expect(recipientFrom(contact, { email: " ada@example.com " })).toBe(
      "ada@example.com",
    );
    expect(recipientFrom(contact, { email: "not an email" })).toBeNull();
    expect(recipientFrom(contact, { email: "a@b.co\nBcc: x@y.z" })).toBeNull();
    expect(recipientFrom(undefined, "a@b.co")).toBeNull();
  });

  it("fill in answers, keep the subject on one line, and escape everything", () => {
    const email = buildConfirmationEmail({
      settings: {
        ...DEFAULT_CONFIRMATION,
        enabled: true,
        subject: "Thanks {{answer:name}}\nBcc: x@y.z",
        body: "Hi {{answer:name}}, <script>alert(1)</script>",
      },
      schema,
      answers: { name: "<b>Ada</b>" },
      variables: {},
      hidden: {},
      to: "ada@example.com",
    });
    expect(email.subject).toBe("Thanks <b>Ada</b> Bcc: x@y.z");
    expect(email.html).not.toContain("<script>alert(1)");
    expect(email.html).not.toContain("<b>Ada</b>");
    expect(email.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(email.text).toBe("Hi <b>Ada</b>, <script>alert(1)</script>");
  });
});
