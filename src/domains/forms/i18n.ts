import type { FormSchemaV1 } from "./schema/v1";

/**
 * Multilingual forms (PRD P2.21). Two parts:
 * 1. The form's own text in other languages — `schema.translations`,
 *    keyed by the same stable question / option / ending ids, so every
 *    language shares one response schema and one set of analytics.
 *    `translateSchema` lays a language over the form; anything not
 *    translated falls back to the default language's text.
 * 2. FormCraft's own interface words (OK, Back, Submit…) — `uiStrings`.
 */

export const LANGUAGES = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  it: "Italiano",
  nl: "Nederlands",
  hi: "हिन्दी",
  ja: "日本語",
  zh: "中文",
  ar: "العربية",
} as const;
export type LanguageCode = keyof typeof LANGUAGES;
export const LANGUAGE_CODES = Object.keys(LANGUAGES) as LanguageCode[];
export const RTL_LANGUAGES = new Set<LanguageCode>(["ar"]);

export type UiStrings = {
  ok: string;
  submit: string;
  start: string;
  continue: string;
  back: string;
  pressEnter: string;
  newLine: string;
  typeAnswer: string;
  chooseMany: string;
  welcomeBack: string;
  savedAsYouGo: string;
  detailsSaved: string;
  finishLater: string;
  language: string;
  followUp: string;
  followUpHint: string;
  thinking: string;
  skippedKnown: string;
  answerAgain: string;
};

const EN: UiStrings = {
  ok: "OK",
  submit: "Submit",
  start: "Start",
  continue: "Continue",
  back: "Back",
  pressEnter: "press Enter ↵",
  newLine: "Shift ⇧ + Enter ↵ for a new line",
  typeAnswer: "Type your answer here…",
  chooseMany: "Choose as many as you like",
  welcomeBack: "Welcome back. Picking up where you left off.",
  savedAsYouGo: "Your answers are saved as you go.",
  detailsSaved: "Your details are saved when you continue, even if you don't finish.",
  finishLater: "Finish later",
  language: "Language",
  followUp: "One more question",
  followUpHint: "Optional. Leave it blank to skip.",
  thinking: "One moment…",
  skippedKnown: "We skipped what you've answered before.",
  answerAgain: "Answer again",
};

const UI: Partial<Record<LanguageCode, Partial<UiStrings>>> = {
  es: {
    ok: "Aceptar",
    submit: "Enviar",
    start: "Empezar",
    continue: "Continuar",
    back: "Atrás",
    pressEnter: "pulsa Intro ↵",
    newLine: "Mayús ⇧ + Intro ↵ para una nueva línea",
    typeAnswer: "Escribe tu respuesta aquí…",
    chooseMany: "Elige todas las que quieras",
    welcomeBack: "Bienvenido de nuevo. Seguimos donde lo dejaste.",
    savedAsYouGo: "Tus respuestas se guardan sobre la marcha.",
    detailsSaved: "Tus datos se guardan al continuar, aunque no termines.",
    finishLater: "Terminar más tarde",
    language: "Idioma",
  },
  fr: {
    ok: "OK",
    submit: "Envoyer",
    start: "Commencer",
    continue: "Continuer",
    back: "Retour",
    pressEnter: "appuyez sur Entrée ↵",
    newLine: "Maj ⇧ + Entrée ↵ pour aller à la ligne",
    typeAnswer: "Saisissez votre réponse ici…",
    chooseMany: "Choisissez-en autant que vous voulez",
    welcomeBack: "Bon retour. On reprend là où vous en étiez.",
    savedAsYouGo: "Vos réponses sont enregistrées au fur et à mesure.",
    detailsSaved:
      "Vos coordonnées sont enregistrées quand vous continuez, même si vous ne terminez pas.",
    finishLater: "Terminer plus tard",
    language: "Langue",
  },
  de: {
    ok: "OK",
    submit: "Absenden",
    start: "Starten",
    continue: "Weiter",
    back: "Zurück",
    pressEnter: "Eingabe drücken ↵",
    newLine: "Umschalt ⇧ + Eingabe ↵ für eine neue Zeile",
    typeAnswer: "Antwort hier eingeben…",
    chooseMany: "Wähle so viele, wie du möchtest",
    welcomeBack: "Willkommen zurück. Es geht dort weiter, wo du aufgehört hast.",
    savedAsYouGo: "Deine Antworten werden laufend gespeichert.",
    detailsSaved:
      "Deine Angaben werden beim Weitergehen gespeichert, auch wenn du nicht fertig wirst.",
    finishLater: "Später fertigstellen",
    language: "Sprache",
  },
  pt: {
    ok: "OK",
    submit: "Enviar",
    start: "Começar",
    continue: "Continuar",
    back: "Voltar",
    pressEnter: "pressione Enter ↵",
    newLine: "Shift ⇧ + Enter ↵ para nova linha",
    typeAnswer: "Digite sua resposta aqui…",
    chooseMany: "Escolha quantas quiser",
    welcomeBack: "Bem-vindo de volta. Continuando de onde você parou.",
    savedAsYouGo: "Suas respostas são salvas enquanto você responde.",
    detailsSaved: "Seus dados são salvos ao continuar, mesmo que não termine.",
    finishLater: "Terminar depois",
    language: "Idioma",
  },
  it: {
    ok: "OK",
    submit: "Invia",
    start: "Inizia",
    continue: "Continua",
    back: "Indietro",
    pressEnter: "premi Invio ↵",
    typeAnswer: "Scrivi qui la tua risposta…",
    chooseMany: "Scegli tutte quelle che vuoi",
    savedAsYouGo: "Le tue risposte vengono salvate man mano.",
    finishLater: "Finisci più tardi",
    language: "Lingua",
  },
  nl: {
    ok: "OK",
    submit: "Versturen",
    start: "Starten",
    continue: "Doorgaan",
    back: "Terug",
    pressEnter: "druk op Enter ↵",
    typeAnswer: "Typ hier je antwoord…",
    chooseMany: "Kies er zoveel als je wilt",
    savedAsYouGo: "Je antwoorden worden onderweg bewaard.",
    finishLater: "Later afmaken",
    language: "Taal",
  },
  hi: {
    ok: "ठीक है",
    submit: "जमा करें",
    start: "शुरू करें",
    continue: "जारी रखें",
    back: "पीछे",
    pressEnter: "Enter ↵ दबाएँ",
    typeAnswer: "अपना उत्तर यहाँ लिखें…",
    chooseMany: "जितने चाहें उतने चुनें",
    savedAsYouGo: "आपके उत्तर साथ-साथ सहेजे जाते हैं।",
    finishLater: "बाद में पूरा करें",
    language: "भाषा",
  },
  ja: {
    ok: "OK",
    submit: "送信",
    start: "開始",
    continue: "続ける",
    back: "戻る",
    pressEnter: "Enter ↵ を押す",
    typeAnswer: "ここに回答を入力…",
    chooseMany: "いくつでも選べます",
    savedAsYouGo: "回答は自動で保存されます。",
    finishLater: "あとで続ける",
    language: "言語",
  },
  zh: {
    ok: "确定",
    submit: "提交",
    start: "开始",
    continue: "继续",
    back: "返回",
    pressEnter: "按 Enter ↵",
    typeAnswer: "在此输入你的回答…",
    chooseMany: "可多选",
    savedAsYouGo: "你的回答会自动保存。",
    finishLater: "稍后完成",
    language: "语言",
  },
  ar: {
    ok: "موافق",
    submit: "إرسال",
    start: "ابدأ",
    continue: "متابعة",
    back: "رجوع",
    pressEnter: "اضغط Enter ↵",
    typeAnswer: "اكتب إجابتك هنا…",
    chooseMany: "اختر ما تشاء",
    savedAsYouGo: "تُحفظ إجاباتك أثناء الإجابة.",
    finishLater: "أكمل لاحقًا",
    language: "اللغة",
  },
};

export function uiStrings(language: string | undefined): UiStrings {
  return { ...EN, ...(UI[language as LanguageCode] ?? {}) };
}

/** The languages a form can be filled in, default first. */
export function formLanguages(schema: Pick<FormSchemaV1, "languages">): LanguageCode[] {
  const base = (schema.languages?.default ?? "en") as LanguageCode;
  return [
    base,
    ...((schema.languages?.others ?? []) as LanguageCode[]).filter((l) => l !== base),
  ];
}

/** Which language to show: an explicit choice if the form offers it,
 * else the best match from the browser, else the default. */
export function pickLanguage(
  schema: Pick<FormSchemaV1, "languages">,
  requested: string | null | undefined,
  acceptLanguage?: string | null,
): LanguageCode {
  const offered = formLanguages(schema);
  if (requested && offered.includes(requested as LanguageCode))
    return requested as LanguageCode;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (offered.includes(code as LanguageCode)) return code as LanguageCode;
  }
  return offered[0];
}

/** The form in `language`: translated text over the default, by id.
 * Ids, order, logic and settings never change. */
export function translateSchema(schema: FormSchemaV1, language: string): FormSchemaV1 {
  const t = schema.translations?.[language as LanguageCode];
  if (!t || language === (schema.languages?.default ?? "en")) return schema;
  const pick = (value: string | undefined, fallback: string) => value?.trim() || fallback;
  const pickOptional = (value: string | undefined, fallback: string | undefined) =>
    value?.trim() || fallback;
  return {
    ...schema,
    meta: {
      ...schema.meta,
      title: pick(t.meta?.title, schema.meta.title),
      description: pickOptional(t.meta?.description, schema.meta.description),
    },
    questions: schema.questions.map((q) => {
      const tq = t.questions?.[q.id];
      if (!tq) return q;
      const settings = { ...(q.settings as Record<string, unknown>) };
      if (Array.isArray(settings.options)) {
        settings.options = (settings.options as { id: string; label: string }[]).map(
          (o) => ({
            ...o,
            label: pick(tq.options?.[o.id], o.label),
          }),
        );
      }
      for (const key of ["placeholder", "buttonLabel", "yesLabel", "noLabel"] as const) {
        const value = tq[key];
        if (value?.trim()) settings[key] = value.trim();
      }
      return {
        ...q,
        label: pick(tq.label, q.label),
        description: pickOptional(tq.description, q.description),
        settings,
      } as typeof q;
    }),
    endings: schema.endings.map((e) => {
      const te = t.endings?.[e.id];
      if (!te) return e;
      return {
        ...e,
        title: pick(te.title, e.title),
        description: pickOptional(te.description, e.description),
        buttonLabel: pickOptional(te.buttonLabel, e.buttonLabel),
      };
    }),
  };
}
