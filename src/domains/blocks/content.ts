import { nanoid } from "nanoid";
import { z } from "zod";
import { QuestionV1 } from "@/domains/forms/schema/v1";

/**
 * Reusable, governed question blocks (master spec F-09) — the pure part,
 * shared by the builder and the server.
 *
 * A block version is a list of questions. Inside a form, a block's
 * questions are copies tagged with `block: { id, version, instance,
 * source }`. The product owner's rules (2026-10-29):
 * - the copy's content is locked in the form — to change it there, the
 *   form detaches it (it becomes ordinary questions);
 * - a new version reaches a form only when an editor of that form
 *   reviews and applies it to the draft; published forms change only when
 *   republished;
 * - editors and up create and edit blocks.
 *
 * "Content" is what the block owns: type, text, required and settings.
 * The form owns the rest — show conditions, checks, scoring weights and
 * option points, "ask once" and link prefill — because those point at the
 * form's own questions and variables, which a block can't know.
 */

export type BlockRef = NonNullable<QuestionV1["block"]>;

/** What a block version stores per question. */
export type BlockQuestion = QuestionV1;

const MAX_BLOCK_QUESTIONS = 50;

/** The parts of a question a block governs, in a stable shape for
 * comparing. Option points and carried-forward options belong to the
 * form, so they're left out. */
export function blockContent(question: QuestionV1): Record<string, unknown> {
  const settings = { ...(question.settings as Record<string, unknown>) };
  delete settings.optionsFrom;
  if (Array.isArray(settings.options)) {
    settings.options = (settings.options as Record<string, unknown>[]).map(
      ({ scores: _scores, ...option }) => {
        void _scores;
        return option;
      },
    );
  }
  return {
    type: question.type,
    label: question.label,
    description: question.description ?? null,
    required: question.required,
    settings,
  };
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

export function sameContent(a: QuestionV1, b: QuestionV1): boolean {
  return canonical(blockContent(a)) === canonical(blockContent(b));
}

/** A form's questions as a block version: content only, each keeping its
 * id (the block's own id for it from then on). */
export function toBlockQuestions(questions: QuestionV1[]): BlockQuestion[] {
  return questions.map((q, order) => {
    const content = blockContent(q);
    return {
      id: q.id,
      order,
      ...content,
      description: q.description,
    } as QuestionV1;
  });
}

/** Parses stored or submitted block questions: valid questions, unique
 * ids, nothing a block can't hold (a welcome screen). */
export function parseBlockQuestions(raw: unknown): BlockQuestion[] {
  const list = z.array(QuestionV1).min(1).max(MAX_BLOCK_QUESTIONS).parse(raw);
  if (new Set(list.map((q) => q.id)).size !== list.length) {
    throw new Error("two questions in the block share an id");
  }
  if (list.some((q) => q.type === "welcome_screen")) {
    throw new Error("a block can't hold a welcome screen");
  }
  return toBlockQuestions(list);
}

function newId(prefix: string) {
  return `${prefix}_${nanoid(10)}`;
}

/** Copies of a block version's questions for a form, tagged as one new
 * insertion of the block. */
export function instantiate(
  block: { id: string; version: number },
  questions: BlockQuestion[],
): QuestionV1[] {
  const instance = newId("bi");
  return questions.map(
    (q) =>
      ({
        ...q,
        id: newId("q"),
        block: { id: block.id, version: block.version, instance, source: q.id },
      }) as QuestionV1,
  );
}

/** The form's insertions of blocks, in form order. */
export function blockInstances(
  questions: QuestionV1[],
): { instance: string; blockId: string; version: number; questionIds: string[] }[] {
  const out = new Map<
    string,
    { instance: string; blockId: string; version: number; questionIds: string[] }
  >();
  for (const q of [...questions].sort((a, b) => a.order - b.order)) {
    if (!q.block) continue;
    const entry = out.get(q.block.instance) ?? {
      instance: q.block.instance,
      blockId: q.block.id,
      version: q.block.version,
      questionIds: [],
    };
    entry.questionIds.push(q.id);
    out.set(q.block.instance, entry);
  }
  return [...out.values()];
}

/** Makes an insertion ordinary questions: same ids, same answers, no
 * longer locked or updated. */
export function detach(questions: QuestionV1[], instance: string): QuestionV1[] {
  return questions.map((q) => {
    if (q.block?.instance !== instance) return q;
    const { block: _block, ...rest } = q;
    void _block;
    return rest as QuestionV1;
  });
}

/**
 * Applies another version of a block to one insertion. Questions the two
 * versions share keep their ids in the form (so answers, logic and
 * translations stay attached) and keep the form's own parts; new ones are
 * added after the insertion's last question; removed ones leave the form.
 * Whether the result still makes sense (logic pointing at a removed
 * question or option) is for validateSemantics, as for any edit.
 */
export function applyVersion(
  questions: QuestionV1[],
  instance: string,
  version: { version: number; questions: BlockQuestion[] },
): QuestionV1[] {
  const ordered = [...questions].sort((a, b) => a.order - b.order);
  const mine = ordered.filter((q) => q.block?.instance === instance);
  if (mine.length === 0) return questions;
  const blockId = mine[0].block!.id;
  const bySource = new Map(mine.map((q) => [q.block!.source, q]));
  const insertAt = ordered.indexOf(mine[mine.length - 1]);

  const updated: QuestionV1[] = version.questions.map((source) => {
    const existing = bySource.get(source.id);
    const formOnly = existing
      ? {
          visibleIf: existing.visibleIf,
          validations: existing.validations,
          weight: existing.weight,
          profileKey: existing.profileKey,
          prefillKey: existing.prefillKey,
        }
      : {};
    const settings = { ...(source.settings as Record<string, unknown>) };
    // Option points stay with the form, matched by option id.
    const oldOptions = (
      existing?.settings as { options?: { id: string; scores?: unknown }[] }
    )?.options;
    if (Array.isArray(settings.options) && oldOptions) {
      settings.options = (settings.options as { id: string }[]).map((o) => {
        const scores = oldOptions.find((x) => x.id === o.id)?.scores;
        return scores ? { ...o, scores } : o;
      });
    }
    return {
      ...source,
      ...Object.fromEntries(Object.entries(formOnly).filter(([, v]) => v !== undefined)),
      settings,
      id: existing?.id ?? newId("q"),
      block: { id: blockId, version: version.version, instance, source: source.id },
    } as QuestionV1;
  });

  const before = ordered
    .slice(0, insertAt + 1)
    .filter((q) => q.block?.instance !== instance);
  const after = ordered.slice(insertAt + 1);
  return [...before, ...updated, ...after].map((q, order) => ({ ...q, order }));
}

export type BlockChange =
  | { kind: "added"; label: string }
  | { kind: "removed"; label: string }
  | { kind: "changed"; label: string; was: string };

/** What a new version changes, for the review before applying it. */
export function diffVersions(from: BlockQuestion[], to: BlockQuestion[]): BlockChange[] {
  const changes: BlockChange[] = [];
  const old = new Map(from.map((q) => [q.id, q]));
  const next = new Set(to.map((q) => q.id));
  for (const q of to) {
    const was = old.get(q.id);
    if (!was) changes.push({ kind: "added", label: q.label });
    else if (!sameContent(was, q))
      changes.push({ kind: "changed", label: q.label, was: was.label });
  }
  for (const q of from) {
    if (!next.has(q.id)) changes.push({ kind: "removed", label: q.label });
  }
  return changes;
}

/**
 * The server's lock: every block question in a form must match its block
 * version's content exactly, and an insertion must hold all of that
 * version's questions. Returns a creator-facing problem, or null.
 */
export function lockProblem(
  questions: QuestionV1[],
  versions: Map<string, BlockQuestion[]>,
  names: Map<string, string>,
): string | null {
  for (const instance of blockInstances(questions)) {
    const key = `${instance.blockId}:${instance.version}`;
    const source = versions.get(key);
    const name = names.get(instance.blockId) ?? "a shared block";
    if (!source)
      return `A question comes from ${quoted(name)}, which this workspace doesn't have.`;
    const mine = questions.filter((q) => q.block?.instance === instance.instance);
    if (mine.length !== source.length) {
      return `Questions from ${quoted(name)} were added or removed in this form. Detach the block to change it here.`;
    }
    for (const q of mine) {
      const original = source.find((s) => s.id === q.block!.source);
      if (!original || !sameContent(original, q)) {
        return `“${q.label.trim() || "A question"}” comes from ${quoted(name)} and can't be changed here. Detach the block to edit it, or edit the block itself.`;
      }
    }
  }
  return null;
}

function quoted(name: string) {
  return `the block “${name}”`;
}
