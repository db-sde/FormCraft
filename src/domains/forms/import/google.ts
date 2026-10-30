import {
  clip,
  optionId,
  plainText,
  type ImportedForm,
  type ImportedJump,
  type ImportedQuestion,
} from "./build";

/**
 * Google Forms (F-05). A public form's page carries its definition as a
 * JavaScript array, `FB_PUBLIC_LOAD_DATA_`. Its layout isn't documented;
 * what's read here is what's stable across public forms:
 *
 *   data[1][0]  description        data[1][8]  title
 *   data[1][1]  items: [id, title, description, typeCode, entries, …]
 *   entries[0]: [entryId, options, required(0|1), extras…]
 *   option:     [label, null, goTo(section id | -2 next | -3 submit), null, isOther]
 *
 * Anything that doesn't match is reported unknown, never guessed.
 */

type Raw = unknown[];

const arr = (v: unknown): Raw => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The data array from the page's HTML, or null. */
export function extractGoogleData(html: string): Raw | null {
  const m = /FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/.exec(html);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as unknown;
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** Whether a Google page is the sign-in wall (a form not shared publicly). */
export function isGoogleSignIn(html: string): boolean {
  return (
    /accounts\.google\.com\/(?:ServiceLogin|v3\/signin)/.test(html) &&
    !html.includes("FB_PUBLIC_LOAD_DATA_")
  );
}

const NEXT_SECTION = -2;
const SUBMIT = -3;

/** A page of the form. `goToAfter` is where the form goes once this
 * page is done: Google stores it on the section break that ends it. */
type Section = {
  sourceId: string;
  firstQuestion: string | null;
  lastAnswerable: string | null;
  goToAfter: unknown;
};

export function parseGoogleForm(data: Raw): ImportedForm {
  const body = arr(data[1]);
  const items = arr(body[1]);
  const title = plainText(body[8], 200) || plainText(data[3], 200) || "Imported form";
  const form: ImportedForm = {
    title,
    description: plainText(body[0], 2000) || undefined,
    // Google shows a page of questions at a time: the classic layout.
    layout: "classic",
    items: [],
    endings: [],
    jumps: [],
    logicNotes: [],
    notes: [
      "Google Forms styling (colours, header image, fonts) isn't copied; pick a theme in Design.",
      "Responses already collected in Google Forms stay there; none are imported.",
    ],
  };

  // Option jumps are by section; sections resolve to their first question
  // once every item has been read.
  let current: Section = {
    sourceId: "__start",
    firstQuestion: null,
    lastAnswerable: null,
    goToAfter: null,
  };
  const sections: Section[] = [current];
  const optionJumps: { from: string; label: string; goTo: number | string }[] = [];
  let questionCount = 0;
  let hasOptionImages = false;

  const push = (q: ImportedQuestion) => {
    form.items.push(q);
    questionCount += 1;
    if (current.firstQuestion === null) current.firstQuestion = q.sourceId;
    if (q.type !== "statement") current.lastAnswerable = q.sourceId;
  };

  for (const rawItem of items) {
    const item = arr(rawItem);
    const id = String(item[0] ?? `g_${questionCount}`);
    const label = plainText(item[1], 1000);
    const description = plainText(item[2], 2000) || undefined;
    const type = item[3];
    const entries = arr(item[4]);
    const entry = arr(entries[0]);
    const required = entry[2] === 1 || entry[2] === true;
    const named = label || "Untitled";

    const choices = (list: unknown) =>
      arr(list)
        .map((o) => arr(o))
        .filter((o) => str(o[0]) !== "" || o[4] === 1 || o[4] === true);

    switch (type) {
      case 0: {
        // Short answer, perhaps with a "response validation".
        const validation = arr(arr(entry[4])[0]);
        const kind = validation[0];
        const sub = validation[1];
        if (kind === 2 && sub === 102) {
          push({
            sourceId: id,
            type: "email",
            label,
            description,
            required,
            status: "converted",
            note: "Became an email question (it checked for an email address).",
          });
        } else if (kind === 2 && sub === 103) {
          push({
            sourceId: id,
            type: "url",
            label,
            description,
            required,
            status: "converted",
            note: "Became a website question (it checked for a URL).",
          });
        } else if (kind === 1) {
          push({
            sourceId: id,
            type: "number",
            label,
            description,
            required,
            status: "converted",
            note: "Became a number question; its exact number rule wasn't copied.",
          });
        } else {
          push({
            sourceId: id,
            type: "short_text",
            label,
            description,
            required,
            status: validation.length ? "converted" : "imported",
            ...(validation.length
              ? { note: "Its response validation rule wasn't copied." }
              : {}),
          });
        }
        break;
      }
      case 1:
        push({
          sourceId: id,
          type: "long_text",
          label,
          description,
          required,
          status: "imported",
        });
        break;
      case 2:
      case 3:
      case 4: {
        const opts = choices(entry[1]);
        const other = opts.some((o) => o[4] === 1 || o[4] === true);
        const plain = opts.filter((o) => !(o[4] === 1 || o[4] === true));
        if (plain.some((o) => arr(o[5]).length > 0)) hasOptionImages = true;
        const options = plain.map((o) => ({ id: optionId(), label: clip(o[0], 500) }));
        if (options.length === 0) {
          form.items.push({ unknown: true, label: named, note: "It has no options." });
          break;
        }
        const qtype =
          type === 2 ? "single_select" : type === 3 ? "dropdown" : "multi_select";
        const otherInDropdown = other && qtype === "dropdown";
        push({
          sourceId: id,
          type: qtype,
          label,
          description,
          required,
          settings: {
            options,
            ...(qtype !== "dropdown" ? { allowOther: other } : {}),
          },
          status: otherInDropdown ? "converted" : "imported",
          ...(otherInDropdown ? { note: "Its “Other” choice was left out." } : {}),
        });
        if (type !== 4) {
          for (const o of plain) {
            const goTo = o[2];
            if (typeof goTo === "number" || typeof goTo === "string") {
              optionJumps.push({ from: id, label: clip(o[0], 500), goTo });
            }
          }
        }
        break;
      }
      case 5: {
        // Linear scale: options "1".."5", end labels in entry[3].
        const values = choices(entry[1])
          .map((o) => Number(o[0]))
          .filter(Number.isInteger);
        const ends = arr(entry[3]);
        if (values.length < 2) {
          form.items.push({
            unknown: true,
            label: named,
            note: "Its scale couldn't be read.",
          });
          break;
        }
        push({
          sourceId: id,
          type: "opinion_scale",
          label,
          description,
          required,
          settings: {
            min: Math.min(...values),
            max: Math.max(...values),
            leftLabel: clip(ends[0], 100) || undefined,
            rightLabel: clip(ends[1], 100) || undefined,
          },
          status: "imported",
        });
        break;
      }
      case 6:
        // A title-and-description block.
        if (!label && !description) break;
        push({
          sourceId: id,
          type: "statement",
          label: label || "Note",
          description,
          status: "converted",
          note: "A text block became a statement screen.",
        });
        break;
      case 7: {
        // Grid: one entry per row; columns on each row.
        const rows = entries.map((e) => arr(e)).filter((e) => arr(e[3]).length);
        const columns = choices(arr(rows[0])[1]).map((o) => ({
          id: optionId(),
          label: clip(o[0], 300),
        }));
        const multiple = arr(arr(rows[0])[11])[0] === 1;
        if (rows.length === 0 || columns.length < 2) {
          form.items.push({
            unknown: true,
            label: named,
            note: "Its grid couldn't be read.",
          });
          break;
        }
        push({
          sourceId: id,
          type: "matrix",
          label,
          description,
          required: rows.some((r) => r[2] === 1),
          settings: {
            rows: rows
              .slice(0, 30)
              .map((r) => ({ id: optionId(), label: clip(arr(r[3])[0], 300) })),
            columns: columns.slice(0, 10),
            multiple,
          },
          status: rows.length > 30 || columns.length > 10 ? "converted" : "imported",
          ...(rows.length > 30 || columns.length > 10
            ? { note: "Only the first 30 rows and 10 columns fit." }
            : {}),
        });
        break;
      }
      case 8: {
        // Section: a new page. Its title and description become a
        // statement on that page.
        current.goToAfter = item[5];
        current = {
          sourceId: id,
          firstQuestion: null,
          lastAnswerable: null,
          goToAfter: null,
        };
        sections.push(current);
        form.items.push({
          sourceId: `${id}_break`,
          type: "page_break",
          label: "",
          status: "imported",
        });
        if (label || description) {
          push({
            sourceId: `${id}_title`,
            type: "statement",
            label: label || "Next section",
            description,
            status: "converted",
            note: "The section's title became a statement at the top of its page.",
          });
        }
        break;
      }
      case 9: {
        const extras = arr(entry[7]);
        const withTime = extras[0] === 1;
        push({
          sourceId: id,
          type: withTime ? "datetime" : "date",
          label,
          description,
          required,
          status: extras[1] === 0 ? "converted" : "imported",
          ...(extras[1] === 0
            ? { note: "Google asked without a year; this asks for a full date." }
            : {}),
        });
        break;
      }
      case 10: {
        const duration = arr(entry[6])[0] === 1;
        if (duration) {
          form.items.push({
            unknown: true,
            label: named,
            note: "Durations aren't a question type here.",
          });
        } else {
          push({
            sourceId: id,
            type: "time",
            label,
            description,
            required,
            status: "imported",
          });
        }
        break;
      }
      case 13:
        push({
          sourceId: id,
          type: "file_upload",
          label,
          description,
          required,
          status: "converted",
          note: "Check the accepted file types and size; Google's limits weren't copied.",
        });
        break;
      case 18: {
        const scale = choices(entry[1]).length;
        push({
          sourceId: id,
          type: "rating",
          label,
          description,
          required,
          settings: { scale: scale > 5 ? 10 : 5 },
          status: scale === 5 || scale === 10 ? "imported" : "converted",
          ...(scale === 5 || scale === 10
            ? {}
            : { note: `Ratings here are out of 5 or 10 (it was out of ${scale}).` }),
        });
        break;
      }
      case 11:
        form.items.push({
          unknown: true,
          label: named || "Image",
          note: "Images between questions aren't imported.",
        });
        break;
      case 12:
        form.items.push({
          unknown: true,
          label: named || "Video",
          note: "Videos aren't imported.",
        });
        break;
      default:
        form.items.push({
          unknown: true,
          label: named,
          note: "This kind of question isn't supported.",
        });
    }
  }
  if (hasOptionImages) {
    form.notes.push(
      "Option pictures weren't copied; add them again in each question's settings.",
    );
  }

  // Section ids → their first question; jumps by answer and by section.
  const firstOf = new Map(sections.map((s) => [s.sourceId, s.firstQuestion]));
  const target = (goTo: unknown): ImportedJump["to"] | null => {
    if (goTo === SUBMIT) return { kind: "end" };
    const first = firstOf.get(String(goTo));
    return first ? { kind: "question", sourceId: first } : null;
  };
  for (const j of optionJumps) {
    if (j.goTo === NEXT_SECTION || j.goTo === 0) continue;
    const to = target(j.goTo);
    if (!to) {
      form.logicNotes.push(
        `“${j.label}” led to a section that couldn't be found, so that jump was left out.`,
      );
      continue;
    }
    form.jumps.push({ fromSourceId: j.from, optionLabel: j.label, to });
  }
  // "After section N, go to …": a jump from the page's last question.
  sections.forEach((section, i) => {
    const goTo = section.goToAfter;
    if (goTo === null || goTo === undefined || goTo === NEXT_SECTION || goTo === 0)
      return;
    const to = target(goTo);
    if (to && section.lastAnswerable) {
      form.jumps.push({ fromSourceId: section.lastAnswerable, optionLabel: null, to });
    } else {
      form.logicNotes.push(`Where page ${i + 1} goes next couldn't be rebuilt.`);
    }
  });
  return form;
}
