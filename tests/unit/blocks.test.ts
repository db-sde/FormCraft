import { describe, expect, it } from "vitest";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import {
  applyVersion,
  blockInstances,
  detach,
  diffVersions,
  instantiate,
  lockProblem,
  parseBlockQuestions,
  sameContent,
  toBlockQuestions,
} from "@/domains/blocks/content";

const BLOCK = "0f8fad5b-d9cb-469f-a165-70867728950e";

const v1 = parseBlockQuestions([
  {
    id: "src_role",
    type: "single_select",
    order: 0,
    label: "Your role",
    required: true,
    settings: {
      allowOther: false,
      options: [
        { id: "o_dev", label: "Developer" },
        { id: "o_pm", label: "Product" },
      ],
    },
  },
  {
    id: "src_team",
    type: "number",
    order: 1,
    label: "Team size",
    required: false,
    settings: {},
  },
]);

describe("question blocks (F-09)", () => {
  it("keeps only content: show conditions, checks and option points are the form's", () => {
    const [copy] = instantiate({ id: BLOCK, version: 1 }, v1);
    const withFormParts = {
      ...copy,
      visibleIf: { type: "compare", left: { type: "literal", value: 1 }, op: "eq" },
      prefillKey: "role",
      settings: {
        ...(copy.settings as object),
        options: [
          { id: "o_dev", label: "Developer", scores: [{ variableId: "v", points: 2 }] },
          { id: "o_pm", label: "Product" },
        ],
      },
    } as QuestionV1;
    expect(sameContent(copy, withFormParts)).toBe(true);
    expect(sameContent(copy, { ...copy, label: "Job title" } as QuestionV1)).toBe(false);
    expect(sameContent(copy, { ...copy, required: false } as QuestionV1)).toBe(false);
  });

  it("copies a version into a form as one tagged insertion with fresh ids", () => {
    const copies = instantiate({ id: BLOCK, version: 1 }, v1);
    expect(copies.map((q) => q.block?.source)).toEqual(["src_role", "src_team"]);
    expect(new Set(copies.map((q) => q.block?.instance)).size).toBe(1);
    expect(copies.every((q) => !q.id.startsWith("src_"))).toBe(true);
    // Two insertions of one block never share ids.
    const again = instantiate({ id: BLOCK, version: 1 }, v1);
    expect(again[0].id).not.toBe(copies[0].id);
    expect(blockInstances([...copies, ...again])).toHaveLength(2);
  });

  it("applies a newer version: same ids for shared questions, form parts kept, new ones added, gone ones removed", () => {
    const own: QuestionV1 = {
      id: "q_intro",
      type: "short_text",
      order: 0,
      label: "Name",
      required: false,
      settings: {},
    };
    const copies = instantiate({ id: BLOCK, version: 1 }, v1).map((q, i) => ({
      ...q,
      order: i + 1,
    }));
    const role = {
      ...copies[0],
      visibleIf: {
        type: "compare",
        left: { type: "literal", value: 1 },
        op: "is_not_empty",
      },
    } as QuestionV1;
    const form = [own, role, copies[1]];
    const v2 = parseBlockQuestions([
      { ...v1[0], label: "Your main role" },
      {
        id: "src_country",
        type: "short_text",
        order: 1,
        label: "Country",
        required: false,
        settings: {},
      },
    ]);
    const next = applyVersion(form, role.block!.instance, { version: 2, questions: v2 });
    expect(next.map((q) => q.label)).toEqual(["Name", "Your main role", "Country"]);
    expect(next[1].id).toBe(role.id);
    expect(next[1].visibleIf).toEqual(role.visibleIf);
    expect(next[1].block?.version).toBe(2);
    expect(next.map((q) => q.order)).toEqual([0, 1, 2]);
    expect(diffVersions(v1, v2).map((c) => c.kind)).toEqual([
      "changed",
      "added",
      "removed",
    ]);
  });

  it("detaches into ordinary questions, keeping ids", () => {
    const copies = instantiate({ id: BLOCK, version: 1 }, v1);
    const detached = detach(copies, copies[0].block!.instance);
    expect(detached.map((q) => q.id)).toEqual(copies.map((q) => q.id));
    expect(detached.every((q) => q.block === undefined)).toBe(true);
  });

  it("locks copies: an edited or partial insertion is refused, an intact one passes", () => {
    const copies = instantiate({ id: BLOCK, version: 1 }, v1);
    const versions = new Map([[`${BLOCK}:1`, v1]]);
    const names = new Map([[BLOCK, "Screening"]]);
    expect(lockProblem(copies, versions, names)).toBeNull();
    expect(
      lockProblem(
        [{ ...copies[0], label: "Changed" } as QuestionV1, copies[1]],
        versions,
        names,
      ),
    ).toMatch(/can't be changed here/);
    expect(lockProblem([copies[0]], versions, names)).toMatch(/added or removed/);
    expect(lockProblem(copies, new Map(), names)).toMatch(/doesn't have/);
  });

  it("refuses a welcome screen and duplicate ids in a block", () => {
    expect(() =>
      parseBlockQuestions([
        {
          id: "w",
          type: "welcome_screen",
          order: 0,
          label: "Hi",
          required: false,
          settings: {},
        },
      ]),
    ).toThrow(/welcome screen/);
    expect(() => parseBlockQuestions([v1[1], v1[1]])).toThrow(/share an id/);
    // A block's questions carry nothing that points into a form.
    expect(
      toBlockQuestions([
        { ...v1[0], prefillKey: "x", visibleIf: undefined } as QuestionV1,
      ])[0],
    ).not.toHaveProperty("prefillKey");
  });
});
