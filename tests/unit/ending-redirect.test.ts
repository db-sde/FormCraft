import { describe, expect, it } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";
import { endingRedirect } from "@/domains/forms/redirect";

const base = {
  schemaVersion: 1,
  meta: { title: "t" },
  theme: {},
  questions: [{ id: "q1", type: "short_text", order: 0, label: "Q", settings: {} }],
  logic: [],
};

describe("endingRedirect (P2.9)", () => {
  it("uses the ending's own redirect first, with its delay or 3s", () => {
    const schema = parseFormSchema({
      ...base,
      meta: { title: "t", defaultRedirect: { url: "https://example.com/all" } },
      endings: [
        {
          id: "a",
          title: "A",
          isDefault: true,
          redirectUrl: "https://a.example",
          redirectDelaySeconds: 0,
        },
        { id: "b", title: "B", redirectUrl: "https://b.example" },
        { id: "c", title: "C" },
      ],
    });
    const [a, b, c] = schema.endings;
    expect(endingRedirect(schema, a)).toEqual({
      url: "https://a.example",
      delaySeconds: 0,
      fromDefault: false,
    });
    expect(endingRedirect(schema, b)).toMatchObject({
      delaySeconds: 3,
      fromDefault: false,
    });
    // No redirect of its own → the form's default (delay defaults to 3).
    expect(endingRedirect(schema, c)).toEqual({
      url: "https://example.com/all",
      delaySeconds: 3,
      fromDefault: true,
    });
  });

  it("means no redirect when neither is set", () => {
    const schema = parseFormSchema({
      ...base,
      endings: [{ id: "a", title: "A", isDefault: true }],
    });
    expect(endingRedirect(schema, schema.endings[0])).toBeNull();
  });

  it("only accepts https for the default and caps the delay", () => {
    const endings = [{ id: "a", title: "A", isDefault: true }];
    expect(() =>
      parseFormSchema({
        ...base,
        endings,
        meta: { title: "t", defaultRedirect: { url: "http://x.example" } },
      }),
    ).toThrow();
    expect(() =>
      parseFormSchema({
        ...base,
        endings,
        meta: { title: "t", defaultRedirect: { url: "javascript:alert(1)" } },
      }),
    ).toThrow();
    expect(() =>
      parseFormSchema({
        ...base,
        endings,
        meta: {
          title: "t",
          defaultRedirect: { url: "https://x.example", delaySeconds: 31 },
        },
      }),
    ).toThrow();
  });
});
