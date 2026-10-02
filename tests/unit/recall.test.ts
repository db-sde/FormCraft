import { describe, expect, it } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";
import {
  recallTokens,
  renderRecall,
  renderRecallUrl,
  type RecallSource,
} from "@/domains/logic";

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "t" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "contact_info",
      order: 0,
      label: "You",
      settings: { fields: ["name", "email"], requiredFields: [] },
    },
    {
      id: "q_plan",
      type: "single_select",
      order: 1,
      label: "Plan",
      settings: { options: [{ id: "p", label: "Pro" }] },
    },
  ],
  logic: [],
  variables: [
    { id: "v_score", name: "score", type: "number" },
    { id: "v_tags", name: "tags", type: "list" },
  ],
  hiddenFields: [{ name: "source" }],
});

const source: RecallSource = {
  schema,
  answers: { q_name: { name: "Ada", email: "ada@example.com" }, q_plan: "p" },
  variables: { v_score: 72.456, v_tags: ["a", "b"] },
  hidden: { source: "linkedin" },
};

describe("recall", () => {
  it("fills variables, URL fields and formatted answers", () => {
    expect(
      renderRecall(
        "Hi {{answer:q_name}}, you scored {{score}} on {{answer:q_plan}} via {{source}} ({{tags}})",
        source,
      ),
    ).toBe("Hi Ada · ada@example.com, you scored 72.46 on Pro via linkedin (a, b)");
  });

  it("leaves text without tokens alone and drops unknown names", () => {
    expect(renderRecall("Plain", source)).toBe("Plain");
    expect(renderRecall("{{nope}}!", source)).toBe("!");
    expect(renderRecall(undefined, source)).toBeUndefined();
  });

  it("returns text, never markup", () => {
    const evil: RecallSource = {
      ...source,
      hidden: { source: "<img src=x onerror=alert(1)>" },
    };
    // Rendered as a React text node, so this stays inert text.
    expect(renderRecall("{{source}}", evil)).toBe("<img src=x onerror=alert(1)>");
  });

  it("encodes values in links and keeps the creator's host", () => {
    expect(
      renderRecallUrl("https://shop.example/thanks?s={{score}}&src={{source}}", source),
    ).toBe("https://shop.example/thanks?s=72.46&src=linkedin");
    const hostile: RecallSource = { ...source, hidden: { source: "evil.example/x?" } };
    expect(renderRecallUrl("https://{{source}}shop.example/", hostile)).toBe(
      "https://shop.example/",
    );
  });

  it("lists insertable tokens", () => {
    expect(recallTokens(schema).map((t) => t.token)).toEqual([
      "{{score}}",
      "{{tags}}",
      "{{source}}",
      "{{answer:q_name}}",
      "{{answer:q_plan}}",
    ]);
  });
});
