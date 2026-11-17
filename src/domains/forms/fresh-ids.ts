import { nanoid } from "nanoid";
import type { FormSchemaV1 } from "./schema/v1";
import { RECALL_PATTERN } from "@/domains/logic/recall";

/**
 * A form's schema with every stable id replaced by a new one, and every
 * reference to it (logic, conditions, scores, translations, variants,
 * pools, recall in text) pointed at the new id (F-61: a form made from a
 * template shares no ids with the form the template came from).
 *
 * Only places that hold ids are touched: the keys below, record keys that
 * are ids (translations, variant wording, pool levels), and
 * `{{answer:id}}` in text. A label that happens to read like an id stays.
 */
const ID_KEYS = new Set([
  "id",
  "questionId",
  "endingId",
  "variableId",
  "fieldId",
  "nameQuestionId",
  "emailQuestionId",
  // An answer's part (a ranked option, a matrix row, a product item).
  "field",
  // A compared value may be an option id ("is Paris").
  "value",
]);
/** Arrays of ids: a variant's question order, a pool's questions. */
const ID_ARRAY_KEYS = new Set(["order", "questionIds"]);

/** Ids that belong to the form itself, not to the workspace. A shared
 * block's own ids and a booking type are the workspace's, and stay. */
function collectIds(schema: FormSchemaV1): Set<string> {
  const ids = new Set<string>();
  const add = (list: { id: string }[] | undefined) => list?.forEach((x) => ids.add(x.id));
  add(schema.questions);
  add(schema.endings);
  add(schema.logic);
  add(schema.rules);
  add(schema.variables);
  add(schema.pools);
  add(schema.variants);
  for (const q of schema.questions) {
    const s = q.settings as Record<string, unknown>;
    for (const key of ["options", "rows", "columns", "items", "fields"]) {
      if (Array.isArray(s[key])) add(s[key] as { id: string }[]);
    }
    add(q.validations);
  }
  return ids;
}

function freshId(old: string): string {
  const prefix = /^[a-z]+_/.exec(old)?.[0] ?? "x_";
  return `${prefix}${nanoid(10)}`;
}

export function withFreshIds(schema: FormSchemaV1): {
  schema: FormSchemaV1;
  /** Old id → new id. */
  ids: Map<string, string>;
} {
  const ids = new Map([...collectIds(schema)].map((id) => [id, freshId(id)]));
  const swap = (v: string) => ids.get(v) ?? v;
  // One insertion of a shared block keeps one (new) instance id.
  const instances = new Map<string, string>();
  const instance = (old: string) => {
    if (!instances.has(old)) instances.set(old, freshId(old));
    return instances.get(old)!;
  };
  const recall = (text: string) =>
    text.replace(RECALL_PATTERN, (match, token: string) => {
      if (!token.startsWith("answer:")) return match;
      const id = token.slice("answer:".length);
      return ids.has(id) ? match.replace(id, ids.get(id)!) : match;
    });

  function walk(node: unknown, key: string | null): unknown {
    if (typeof node === "string") {
      if (key !== null && ID_KEYS.has(key)) return swap(node);
      return node.includes("{{") ? recall(node) : node;
    }
    if (Array.isArray(node)) {
      if (key !== null && ID_ARRAY_KEYS.has(key)) {
        return node.map((v) => (typeof v === "string" ? swap(v) : walk(v, null)));
      }
      return node.map((v) => walk(v, null));
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        // A shared block copy names the block and its own question id:
        // the workspace's, not this form's.
        if (k === "block" && v && typeof v === "object") {
          out[k] = {
            ...(v as object),
            instance: instance((v as { instance: string }).instance),
          };
          continue;
        }
        out[ids.has(k) ? ids.get(k)! : k] = walk(v, k);
      }
      return out;
    }
    return node;
  }

  return { schema: walk(schema, null) as FormSchemaV1, ids };
}
