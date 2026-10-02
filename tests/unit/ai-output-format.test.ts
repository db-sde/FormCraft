import { describe, expect, it } from "vitest";
import { RuleDraft } from "@/domains/ai/rule-draft";
import { FormDraft } from "@/domains/ai/form-draft";
import { jsonOutputFormat, parseJsonReply } from "@/domains/ai/output-format";

/** Every node in a JSON schema. */
function nodes(node: unknown, out: Record<string, unknown>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => nodes(n, out));
  else if (node && typeof node === "object") {
    out.push(node as Record<string, unknown>);
    Object.values(node).forEach((v) => nodes(v, out));
  }
  return out;
}

describe("AI drafts as structured outputs", () => {
  it.each([
    ["RuleDraft", RuleDraft],
    ["FormDraft", FormDraft],
  ])("%s keeps enums, closes objects and drops unsupported keywords", (_name, zod) => {
    const { type, schema } = jsonOutputFormat(zod);
    expect(type).toBe("json_schema");
    const all = nodes(schema);
    for (const node of all.filter((n) => n.type === "object")) {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties as object));
    }
    for (const node of all) {
      for (const key of ["minimum", "maximum", "$schema", "minLength", "maxLength"]) {
        expect(node).not.toHaveProperty(key);
      }
    }
    // Enums stay enforced (the whole point of building it here).
    expect(
      all.some((n) => Array.isArray(n.enum) && n.enum.includes("go_to_highest")),
    ).toBe(true);
    expect(JSON.stringify(schema)).not.toContain("{enum:");
  });

  it("parses a reply only when it matches the schema", () => {
    const reply = (text: string) => [{ type: "text", text }];
    expect(parseJsonReply(reply("not json"), RuleDraft)).toBeNull();
    expect(parseJsonReply(reply('{"possible": true}'), RuleDraft)).toBeNull();
    expect(parseJsonReply([{ type: "thinking" }], RuleDraft)).toBeNull();
    const draft = {
      possible: false,
      reason: "No.",
      name: "",
      trigger: { event: "form_started", questionNumber: null },
      match: "all",
      conditions: [],
      actions: [],
      newVariables: [],
    };
    expect(parseJsonReply(reply(JSON.stringify(draft)), RuleDraft)).toEqual(draft);
  });
});
