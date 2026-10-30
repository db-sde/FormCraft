import type { CompiledFormV1 } from "./schema/compile";

/**
 * Pages of the classic layout (master spec F-01). Page breaks split the
 * form's ordered questions into pages; a break's label and description
 * head the page after it. Which questions a page shows is the logic
 * engine's business, not the page's: a page shows the questions of its
 * own that are on the respondent's path right now (walkForm with the
 * answers so far), so show conditions, jumps, random and adaptive groups
 * all work exactly as they do one question at a time.
 */

export type FormPage = {
  /** The page break that starts it (null for the first page). */
  breakId: string | null;
  title?: string;
  description?: string;
  /** Its items in form order (questions and screens, never breaks). */
  ids: string[];
};

export function splitPages(compiled: CompiledFormV1): FormPage[] {
  const byId = new Map(compiled.schema.questions.map((q) => [q.id, q]));
  const pages: FormPage[] = [{ breakId: null, ids: [] }];
  for (const id of compiled.orderedQuestionIds) {
    const question = byId.get(id);
    if (!question) continue;
    if (question.type === "page_break") {
      pages.push({
        breakId: id,
        title: question.label.trim() || undefined,
        description: question.description?.trim() || undefined,
        ids: [],
      });
    } else {
      pages[pages.length - 1].ids.push(id);
    }
  }
  // Breaks with nothing between them (or nothing before the first) make
  // no page of their own.
  return pages.filter((page) => page.ids.length > 0);
}

/** A page's items that are on the path. */
export function shownOnPage(page: FormPage, onPath: ReadonlySet<string>): string[] {
  return page.ids.filter((id) => onPath.has(id));
}

/** The first page at or after `from` with anything to show; -1 when the
 * path has nothing more (the next step is the ending). */
export function nextPageWithContent(
  pages: FormPage[],
  onPath: ReadonlySet<string>,
  from: number,
): number {
  for (let i = Math.max(0, from); i < pages.length; i += 1) {
    if (shownOnPage(pages[i], onPath).length > 0) return i;
  }
  return -1;
}

export function pageOf(pages: FormPage[], questionId: string): number {
  return pages.findIndex((page) => page.ids.includes(questionId));
}
