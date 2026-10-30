import type { QuestionType } from "@/domains/forms/schema/question-types";
import {
  clip,
  optionId,
  plainText,
  type ImportedForm,
  type ImportedQuestion,
} from "./build";

/**
 * Typeform (F-05). A public typeform's definition is the same JSON its
 * own renderer loads — fields, welcome and thank-you screens, and logic
 * jumps — in the documented shape of Typeform's Create API. Only "is
 * this choice" and "always" jumps are rebuilt; scoring and comparisons
 * are listed in the report as not imported.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The form definition from a renderer payload or page JSON, or null. */
export function findTypeformDefinition(payload: unknown): Obj | null {
  const seen = new Set<unknown>();
  const visit = (node: unknown, depth: number): Obj | null => {
    if (depth > 6 || !node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    const o = obj(node);
    if (Array.isArray(o.fields) && typeof o.title === "string") return o;
    for (const key of [
      "form",
      "definition",
      "data",
      "props",
      "pageProps",
      "rendererData",
    ]) {
      const found = visit(o[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return visit(payload, 0);
}

/** JSON embedded in a typeform page's HTML, if any. */
export function extractTypeformJson(html: string): unknown {
  const patterns = [
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    /window\.rendererData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/,
  ];
  for (const pattern of patterns) {
    const m = pattern.exec(html);
    if (!m) continue;
    try {
      return JSON.parse(m[1]);
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

const SIMPLE: Record<string, QuestionType> = {
  short_text: "short_text",
  long_text: "long_text",
  email: "email",
  phone_number: "phone",
  website: "url",
  number: "number",
  dropdown: "dropdown",
  yes_no: "yes_no",
  date: "date",
  file_upload: "file_upload",
  statement: "statement",
};

const UNSUPPORTED_NOTE: Record<string, string> = {
  payment: "Payments are set up in this form's Integrations, not imported.",
  calendly: "Scheduling is set on an ending here (Calendly or Cal.com).",
};

export function parseTypeform(definition: Obj): ImportedForm {
  const settings = obj(definition.settings);
  const welcome = obj(list(definition.welcome_screens)[0]);
  const form: ImportedForm = {
    title: plainText(definition.title, 200) || "Imported form",
    layout: "conversational",
    items: [],
    // Typeform's own default thank-you screen is the default ending.
    endings: list(definition.thankyou_screens)
      .map((s) => obj(s))
      .sort((a, b) => Number(b.ref === "default_tys") - Number(a.ref === "default_tys"))
      .map((s) => ({
        sourceId: String(s.ref ?? s.id ?? ""),
        title: plainText(s.title, 200) || "Thank you!",
        description: plainText(obj(s.properties).description, 2000) || undefined,
      })),
    jumps: [],
    logicNotes: [],
    notes: [
      "Typeform's theme isn't copied; pick colours and fonts in Design.",
      "Responses already collected in Typeform stay there; none are imported.",
    ],
    ...(welcome.title
      ? {
          welcome: {
            title: plainText(welcome.title, 1000),
            description:
              plainText(obj(welcome.properties).description, 2000) || undefined,
            buttonLabel: clip(obj(welcome.properties).button_text, 100) || undefined,
          },
        }
      : {}),
  };
  if (settings.is_public === false) {
    form.notes.push(
      "The typeform is marked as not public; check it's the one you meant.",
    );
  }

  // Choice refs → labels, for jumps.
  const choiceLabels = new Map<string, string>();
  let pictures = false;

  const read = (raw: unknown) => {
    const f = obj(raw);
    const p = obj(f.properties);
    const v = obj(f.validations);
    const type = String(f.type ?? "");
    const ref = String(f.ref ?? f.id ?? `tf_${form.items.length}`);
    const label = plainText(f.title, 1000);
    const description = plainText(p.description, 2000) || undefined;
    const required = v.required === true;
    const named = label || "Untitled";
    const base = { sourceId: ref, label, description, required };

    const choices = list(p.choices).map((c) => {
      const choice = obj(c);
      const text = clip(choice.label, 500);
      choiceLabels.set(String(choice.ref ?? choice.id ?? ""), text);
      return { id: optionId(), label: text };
    });

    if (SIMPLE[type]) {
      const q: ImportedQuestion = { ...base, type: SIMPLE[type], status: "imported" };
      if (type === "dropdown") {
        if (choices.length === 0) {
          form.items.push({ unknown: true, label: named, note: "It has no options." });
          return;
        }
        q.settings = { options: choices };
      }
      if (type === "short_text" && typeof v.max_length === "number") {
        q.settings = { maxLength: Math.min(5000, Math.max(1, v.max_length)) };
      }
      if (type === "number") {
        q.settings = {
          ...(typeof v.min_value === "number" ? { min: v.min_value } : {}),
          ...(typeof v.max_value === "number" ? { max: v.max_value } : {}),
        };
      }
      if (type === "file_upload") {
        q.status = "converted";
        q.note = "Check the accepted file types and size; Typeform's weren't copied.";
      }
      form.items.push(q);
      return;
    }

    switch (type) {
      case "multiple_choice":
      case "picture_choice": {
        if (choices.length === 0) {
          form.items.push({ unknown: true, label: named, note: "It has no options." });
          return;
        }
        if (type === "picture_choice") pictures = true;
        const multiple = p.allow_multiple_selection === true;
        form.items.push({
          ...base,
          type: multiple ? "multi_select" : "single_select",
          settings: {
            options: choices,
            allowOther: p.allow_other_choice === true,
            ...(p.randomize === true ? { randomizeOptions: true } : {}),
            ...(type === "picture_choice" ? { layout: "pictures" } : {}),
          },
          status: type === "picture_choice" ? "converted" : "imported",
          ...(type === "picture_choice"
            ? { note: "Picture cards kept; upload the pictures again." }
            : {}),
        });
        return;
      }
      case "legal":
        form.items.push({
          ...base,
          type: "yes_no",
          settings: { yesLabel: "I accept", noLabel: "I don't accept" },
          status: "converted",
          note: "A legal question became Yes / No.",
        });
        return;
      case "rating": {
        const steps = Number(p.steps ?? 5);
        form.items.push({
          ...base,
          type: "rating",
          settings: { scale: steps > 5 ? 10 : 5 },
          status: steps === 5 || steps === 10 ? "imported" : "converted",
          ...(steps === 5 || steps === 10
            ? {}
            : { note: `Ratings here are out of 5 or 10 (it was out of ${steps}).` }),
        });
        return;
      }
      case "opinion_scale":
      case "nps": {
        const steps = type === "nps" ? 11 : Number(p.steps ?? 11);
        const start = type === "nps" ? 0 : p.start_at_one === true ? 1 : 0;
        const labels = obj(p.labels);
        form.items.push({
          ...base,
          type: "opinion_scale",
          settings: {
            min: start,
            max: start + Math.max(1, steps - 1),
            leftLabel: clip(labels.left, 100) || undefined,
            rightLabel: clip(labels.right, 100) || undefined,
          },
          status: type === "nps" ? "converted" : "imported",
          ...(type === "nps" ? { note: "Net Promoter Score became a 0–10 scale." } : {}),
        });
        return;
      }
      case "ranking":
        if (choices.length < 2) {
          form.items.push({ unknown: true, label: named, note: "It needs two options." });
          return;
        }
        form.items.push({
          ...base,
          type: "ranking",
          settings: { options: choices.slice(0, 20) },
          status: choices.length > 20 ? "converted" : "imported",
          ...(choices.length > 20 ? { note: "Only the first 20 options fit." } : {}),
        });
        return;
      case "matrix": {
        const rows = list(p.fields).map((r) => ({
          id: optionId(),
          label: plainText(obj(r).title, 300),
        }));
        const columns = list(obj(obj(list(p.fields)[0]).properties).choices).map((c) => ({
          id: optionId(),
          label: clip(obj(c).label, 300),
        }));
        if (rows.length === 0 || columns.length < 2) {
          form.items.push({
            unknown: true,
            label: named,
            note: "Its grid couldn't be read.",
          });
          return;
        }
        form.items.push({
          ...base,
          type: "matrix",
          settings: {
            rows: rows.slice(0, 30),
            columns: columns.slice(0, 10),
            multiple:
              obj(obj(list(p.fields)[0]).properties).allow_multiple_selection === true,
          },
          status: "imported",
        });
        return;
      }
      case "contact_info":
      case "address": {
        // Sub-fields come as nested questions; map the ones we know.
        const known: Record<string, string> =
          type === "contact_info"
            ? {
                first_name: "name",
                last_name: "name",
                email: "email",
                phone_number: "phone",
                company: "company",
              }
            : {
                address: "line1",
                address_line_2: "line2",
                city: "city",
                state: "state",
                zip: "postalCode",
                country: "country",
              };
        const fields: string[] = [];
        const requiredFields: string[] = [];
        for (const sub of list(p.fields)) {
          const s = obj(sub);
          const mapped = known[String(s.subfield_key ?? s.type)];
          if (!mapped || fields.includes(mapped)) continue;
          fields.push(mapped);
          if (obj(s.validations).required === true) requiredFields.push(mapped);
        }
        const defaults =
          type === "contact_info"
            ? ["name", "email", "phone"]
            : ["line1", "line2", "city", "state", "postalCode", "country"];
        form.items.push({
          ...base,
          type,
          settings: {
            fields: fields.length ? fields : defaults,
            requiredFields: fields.length ? requiredFields : [],
          },
          status: fields.length ? "imported" : "converted",
          ...(fields.length
            ? {}
            : { note: "Its parts couldn't be read; the usual ones are asked." }),
        });
        return;
      }
      case "group": {
        // A question group: its title becomes a statement, its questions
        // follow it.
        if (label || description) {
          form.items.push({
            ...base,
            required: false,
            type: "statement",
            label: label || "Section",
            status: "converted",
            note: "A question group became a statement followed by its questions.",
          });
        }
        for (const child of list(p.fields)) read(child);
        return;
      }
      default:
        form.items.push({
          unknown: true,
          label: named,
          note:
            UNSUPPORTED_NOTE[type] ??
            `“${type || "unknown"}” questions aren't supported.`,
        });
    }
  };

  for (const field of list(definition.fields)) read(field);
  if (pictures) {
    form.notes.push(
      "Picture choice images weren't copied; upload them in each question's settings.",
    );
  }

  // Logic: jumps on "is this choice" or "always"; nothing else.
  const variables = Object.keys(obj(definition.variables));
  if (variables.length > 0) {
    form.logicNotes.push(
      `Typeform variables (${variables.join(", ")}) and their calculations weren't imported.`,
    );
  }
  for (const rawBlock of list(definition.logic)) {
    const block = obj(rawBlock);
    if (block.type !== "field") continue;
    const from = String(block.ref ?? "");
    for (const rawAction of list(block.actions)) {
      const action = obj(rawAction);
      if (action.action !== "jump") {
        form.logicNotes.push(
          `A “${String(action.action)}” action wasn't imported (only jumps are).`,
        );
        continue;
      }
      const to = obj(obj(obj(action.details).to));
      const target =
        to.type === "thankyou"
          ? { kind: "end" as const, endingSourceId: String(to.value ?? "") }
          : to.type === "field"
            ? { kind: "question" as const, sourceId: String(to.value ?? "") }
            : null;
      if (!target) {
        form.logicNotes.push(
          "A jump to something other than a question or ending was left out.",
        );
        continue;
      }
      const condition = obj(action.condition);
      if (condition.op === "always") {
        form.jumps.push({ fromSourceId: from, optionLabel: null, to: target });
        continue;
      }
      const vars = list(condition.vars).map((x) => obj(x));
      const choice = vars.find((x) => x.type === "choice");
      const label = choice ? choiceLabels.get(String(choice.value ?? "")) : undefined;
      if ((condition.op === "is" || condition.op === "equal") && label) {
        form.jumps.push({ fromSourceId: from, optionLabel: label, to: target });
      } else {
        form.logicNotes.push(
          `A jump on “${String(condition.op ?? "a condition")}” wasn't imported; only “is this choice” and “always” jumps are.`,
        );
      }
    }
  }
  return form;
}
