"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { FormSchemaV1, TranslationV1 } from "@/domains/forms/schema/v1";
import { LANGUAGE_CODES, LANGUAGES, type LanguageCode } from "@/domains/forms/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";

type Path =
  | { scope: "meta"; field: "title" | "description" }
  | {
      scope: "questions";
      id: string;
      field:
        "label" | "description" | "placeholder" | "buttonLabel" | "yesLabel" | "noLabel";
    }
  | { scope: "options"; id: string; optionId: string }
  | { scope: "endings"; id: string; field: "title" | "description" | "buttonLabel" };

type Row = {
  key: string;
  group: string;
  label: string;
  source: string;
  path: Path;
  long?: boolean;
};

/** Every piece of creator-written text, in form order. */
function rowsFor(schema: FormSchemaV1): Row[] {
  const rows: Row[] = [
    {
      key: "meta.title",
      group: "Form",
      label: "Title",
      source: schema.meta.title,
      path: { scope: "meta", field: "title" },
    },
  ];
  if (schema.meta.description) {
    rows.push({
      key: "meta.description",
      group: "Form",
      label: "Description",
      source: schema.meta.description,
      path: { scope: "meta", field: "description" },
      long: true,
    });
  }
  let n = 0;
  for (const q of [...schema.questions].sort((a, b) => a.order - b.order)) {
    const group = q.type === "welcome_screen" ? "Welcome screen" : `Question ${++n}`;
    rows.push({
      key: `${q.id}.label`,
      group,
      label: "Question",
      source: q.label,
      path: { scope: "questions", id: q.id, field: "label" },
      long: true,
    });
    if (q.description) {
      rows.push({
        key: `${q.id}.description`,
        group,
        label: "Description",
        source: q.description,
        path: { scope: "questions", id: q.id, field: "description" },
        long: true,
      });
    }
    const settings = q.settings as {
      options?: { id: string; label: string }[];
      placeholder?: string;
      buttonLabel?: string;
      yesLabel?: string;
      noLabel?: string;
    };
    for (const field of ["placeholder", "buttonLabel", "yesLabel", "noLabel"] as const) {
      if (settings[field]) {
        rows.push({
          key: `${q.id}.${field}`,
          group,
          label:
            field === "buttonLabel"
              ? "Button"
              : field === "placeholder"
                ? "Placeholder"
                : field === "yesLabel"
                  ? "Yes"
                  : "No",
          source: settings[field]!,
          path: { scope: "questions", id: q.id, field },
        });
      }
    }
    for (const o of settings.options ?? []) {
      rows.push({
        key: `${q.id}.${o.id}`,
        group,
        label: "Option",
        source: o.label,
        path: { scope: "options", id: q.id, optionId: o.id },
      });
    }
  }
  schema.endings.forEach((e, i) => {
    const group = `Ending ${i + 1}`;
    rows.push({
      key: `${e.id}.title`,
      group,
      label: "Title",
      source: e.title,
      path: { scope: "endings", id: e.id, field: "title" },
    });
    if (e.description)
      rows.push({
        key: `${e.id}.description`,
        group,
        label: "Description",
        source: e.description,
        path: { scope: "endings", id: e.id, field: "description" },
        long: true,
      });
    if (e.buttonLabel)
      rows.push({
        key: `${e.id}.buttonLabel`,
        group,
        label: "Button",
        source: e.buttonLabel,
        path: { scope: "endings", id: e.id, field: "buttonLabel" },
      });
  });
  return rows;
}

function read(t: TranslationV1 | undefined, path: Path): string {
  if (!t) return "";
  if (path.scope === "meta") return t.meta?.[path.field] ?? "";
  if (path.scope === "questions") return t.questions?.[path.id]?.[path.field] ?? "";
  if (path.scope === "options")
    return t.questions?.[path.id]?.options?.[path.optionId] ?? "";
  return t.endings?.[path.id]?.[path.field] ?? "";
}

function write(t: TranslationV1 | undefined, path: Path, value: string): TranslationV1 {
  const next: TranslationV1 = structuredClone(t ?? {});
  const v = value || undefined;
  if (path.scope === "meta") next.meta = { ...next.meta, [path.field]: v };
  else if (path.scope === "endings") {
    next.endings = {
      ...next.endings,
      [path.id]: { ...next.endings?.[path.id], [path.field]: v },
    };
  } else {
    const q = { ...next.questions?.[path.id] };
    if (path.scope === "questions") q[path.field] = v;
    else {
      const options = { ...q.options };
      if (v) options[path.optionId] = v;
      else delete options[path.optionId];
      q.options = options;
    }
    next.questions = { ...next.questions, [path.id]: q };
  }
  return next;
}

/**
 * The builder's Languages view (PRD P2.21): the language the form is
 * written in, the others it offers, and a translation for every piece of
 * text — keyed by the same ids, so logic, answers and reports are shared
 * by all languages. Untranslated text falls back to the original.
 */
export function TranslationsEditor({
  schema,
  onChange,
  allowed,
}: {
  schema: FormSchemaV1;
  onChange: (patch: Partial<FormSchemaV1>) => void;
  /** The plan includes multiple languages on the live form. */
  allowed: boolean;
}) {
  const base = (schema.languages?.default ?? "en") as LanguageCode;
  const others = (schema.languages?.others ?? []) as LanguageCode[];
  const [target, setTarget] = useState<LanguageCode | null>(others[0] ?? null);
  const rows = rowsFor(schema);
  const translation = target ? schema.translations?.[target] : undefined;
  const done = target ? rows.filter((r) => read(translation, r.path).trim()).length : 0;

  const setLanguages = (defaultLanguage: LanguageCode, nextOthers: LanguageCode[]) =>
    onChange({
      languages: {
        default: defaultLanguage,
        others: nextOthers.filter((l) => l !== defaultLanguage),
      },
    });

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 px-9 pt-8 pb-16">
      <div>
        <h1 className="font-heading text-[40px] leading-none font-bold tracking-[-0.03em]">
          Languages
        </h1>
        <p className="text-muted-foreground mt-2.5 max-w-[640px] text-[15px] leading-[1.55]">
          Offer the form in more than one language. People pick one at the top of the form
          (or their browser&apos;s language is used); their answers, logic and your
          reports stay in one place.
        </p>
        {!allowed && (
          <p className="mt-2 text-[13.5px] text-[var(--chip-draft-fg)]">
            Your plan shows the live form in its own language only. Translations you add
            here appear once your plan includes multiple languages.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Written in</span>
        <Select
          value={base}
          onValueChange={(v) => setLanguages(v as LanguageCode, others)}
        >
          <SelectTrigger className="h-[36px] w-[150px]" aria-label="The form's language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_CODES.map((code) => (
              <SelectItem key={code} value={code}>
                {LANGUAGES[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground mx-1">·</span>
        {others.map((code) => (
          <span key={code} className="flex items-center">
            <button
              type="button"
              aria-pressed={target === code}
              onClick={() => setTarget(code)}
              className={cn(
                "fc-focus rounded-l-full border-[1.5px] py-1 pr-1.5 pl-3 text-[13px] font-semibold",
                target === code
                  ? "border-ink bg-primary text-primary-foreground"
                  : "border-input",
              )}
            >
              {LANGUAGES[code]}
            </button>
            <button
              type="button"
              aria-label={`Remove ${LANGUAGES[code]}`}
              onClick={() => {
                const translations = { ...schema.translations };
                delete translations[code];
                onChange({
                  languages: { default: base, others: others.filter((l) => l !== code) },
                  translations,
                });
                if (target === code) setTarget(null);
              }}
              className="fc-focus border-input hover:bg-hover-wash grid h-[30px] place-items-center rounded-r-full border-[1.5px] border-l-0 px-1.5"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <Select
          value=""
          onValueChange={(v) => {
            setLanguages(base, [...others, v as LanguageCode]);
            setTarget(v as LanguageCode);
          }}
        >
          <SelectTrigger
            className="h-[32px] w-auto gap-1.5 text-[13px]"
            aria-label="Add a language"
          >
            <Plus className="size-3.5" />
            <span>Add a language</span>
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_CODES.filter((c) => c !== base && !others.includes(c)).map(
              (code) => (
                <SelectItem key={code} value={code}>
                  {LANGUAGES[code]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      {target ? (
        <section
          aria-label={`${LANGUAGES[target]} translation`}
          className="flex flex-col gap-1"
        >
          <p className="text-muted-foreground mb-2 text-[13px]">
            {done} of {rows.length} translated. Empty ones show in {LANGUAGES[base]}.
          </p>
          {rows.map((row, i) => (
            <div key={row.key}>
              {(i === 0 || rows[i - 1].group !== row.group) && (
                <h3 className="text-muted-foreground mt-4 mb-1.5 text-[11px] font-bold tracking-[0.1em] uppercase">
                  {row.group}
                </h3>
              )}
              <div className="border-input bg-card grid gap-2 rounded-sm border-[1.5px] p-2.5 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
                <span className="text-muted-foreground text-[12.5px] font-semibold">
                  {row.label}
                </span>
                <span className="text-[13.5px] leading-snug whitespace-pre-wrap">
                  {row.source}
                </span>
                {row.long ? (
                  <textarea
                    aria-label={`${row.group} ${row.label.toLowerCase()} in ${LANGUAGES[target]}`}
                    rows={2}
                    value={read(translation, row.path)}
                    onChange={(e) =>
                      onChange({
                        translations: {
                          ...schema.translations,
                          [target]: write(translation, row.path, e.target.value),
                        },
                      })
                    }
                    className="border-input bg-field rounded-sm border-[1.5px] px-2 py-1.5 text-[13.5px]"
                  />
                ) : (
                  <input
                    aria-label={`${row.group} ${row.label.toLowerCase()} in ${LANGUAGES[target]}`}
                    value={read(translation, row.path)}
                    onChange={(e) =>
                      onChange({
                        translations: {
                          ...schema.translations,
                          [target]: write(translation, row.path, e.target.value),
                        },
                      })
                    }
                    className="border-input bg-field h-[34px] rounded-sm border-[1.5px] px-2 text-[13.5px]"
                  />
                )}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <p className="text-muted-foreground text-sm">
          Add a language to start translating.
        </p>
      )}
    </div>
  );
}
