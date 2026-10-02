import { describe, expect, it } from "vitest";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import {
  formLanguages,
  pickLanguage,
  translateSchema,
  uiStrings,
} from "@/domains/forms/i18n";
import { walkForm } from "@/domains/logic";

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Survey" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "fruit",
      type: "single_select",
      order: 0,
      label: "Favourite fruit?",
      settings: {
        options: [
          { id: "apple", label: "Apple" },
          { id: "pear", label: "Pear" },
        ],
      },
    },
    { id: "why", type: "short_text", order: 1, label: "Why?", settings: {} },
  ],
  logic: [],
  languages: { default: "en", others: ["es", "fr"] },
  translations: {
    es: {
      meta: { title: "Encuesta" },
      questions: { fruit: { label: "¿Fruta favorita?", options: { apple: "Manzana" } } },
      endings: { end: { title: "Gracias" } },
    },
  },
});

describe("multilingual forms (P2.21)", () => {
  it("accept translations for only some languages", () => {
    expect(schema.translations?.es?.meta?.title).toBe("Encuesta");
    expect(schema.translations?.fr).toBeUndefined();
  });

  it("translate by id and fall back to the original text", () => {
    const es = translateSchema(schema, "es");
    expect(es.meta.title).toBe("Encuesta");
    const fruit = es.questions[0];
    expect(fruit.label).toBe("¿Fruta favorita?");
    expect(
      (fruit.settings as { options: { id: string; label: string }[] }).options,
    ).toEqual([
      { id: "apple", label: "Manzana" },
      { id: "pear", label: "Pear" },
    ]);
    expect(es.questions[1].label).toBe("Why?");
    expect(es.endings[0].title).toBe("Gracias");
    // Ids, order and logic are untouched: the same answers walk the same way.
    expect(es.questions.map((q) => q.id)).toEqual(["fruit", "why"]);
    expect(
      walkForm(compileFormSchema(es), { fruit: "apple" }).visitedQuestionIds,
    ).toEqual(walkForm(compileFormSchema(schema), { fruit: "apple" }).visitedQuestionIds);
    expect(translateSchema(schema, "fr")).toBe(schema);
    expect(translateSchema(schema, "en")).toBe(schema);
  });

  it("pick the requested language, then the browser's, then the default", () => {
    expect(formLanguages(schema)).toEqual(["en", "es", "fr"]);
    expect(pickLanguage(schema, "fr", "es-ES,es;q=0.9")).toBe("fr");
    expect(pickLanguage(schema, "de", "es-ES,es;q=0.9")).toBe("es");
    expect(pickLanguage(schema, null, "ja")).toBe("en");
  });

  it("translate FormCraft's own words, with English for anything missing", () => {
    expect(uiStrings("es").submit).toBe("Enviar");
    expect(uiStrings("it").welcomeBack).toBe(uiStrings("en").welcomeBack);
    expect(uiStrings("xx").ok).toBe("OK");
  });
});
