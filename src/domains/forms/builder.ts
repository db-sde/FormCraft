import { nanoid } from "nanoid";
import type { QuestionType } from "./schema/question-types";
import type { QuestionV1, OptionV1 } from "./schema/v1";

/** Short, URL-safe, collision-resistant — matches the `stableId` regex
 * in the schema (letters, numbers, -, _). */
function newId(prefix: string): string {
  return `${prefix}_${nanoid(10)}`;
}

const DEFAULT_LABEL: Record<QuestionType, string> = {
  welcome_screen: "Welcome",
  short_text: "Short answer question",
  long_text: "Long answer question",
  email: "What's your email?",
  phone: "What's your phone number?",
  url: "Share a link",
  number: "Enter a number",
  single_select: "Pick one",
  multi_select: "Pick any that apply",
  dropdown: "Choose from a list",
  yes_no: "Yes or no?",
  date: "Pick a date",
  rating: "Rate your experience",
  opinion_scale: "How would you rate this?",
  file_upload: "Upload a file",
  statement: "Statement",
};

/** Type-appropriate default `settings`, matching each type's Zod
 * schema in schema/v1.ts (only fields with no `.default()` need to be
 * seeded here — the rest are filled in by parseFormSchema). */
function defaultSettings(type: QuestionType): QuestionV1["settings"] {
  switch (type) {
    case "welcome_screen":
      return { buttonLabel: "Start" };
    case "short_text":
      return {};
    case "long_text":
      return {};
    case "email":
      return {};
    case "phone":
      return {};
    case "url":
      return {};
    case "number":
      return {};
    case "single_select":
      return { options: [createOption("Option 1"), createOption("Option 2")] };
    case "multi_select":
      return { options: [createOption("Option 1"), createOption("Option 2")] };
    case "dropdown":
      return { options: [createOption("Option 1"), createOption("Option 2")] };
    case "yes_no":
      return {};
    case "date":
      return {};
    case "rating":
      return { scale: 5 };
    case "opinion_scale":
      return { min: 0, max: 10 };
    case "file_upload":
      return { acceptedMimeTypes: ["image/*", "application/pdf"], maxSizeMb: 10 };
    case "statement":
      return { buttonLabel: "Continue" };
  }
}

export function createOption(label = "Option"): OptionV1 {
  return { id: newId("opt"), label };
}

export function createQuestion(type: QuestionType, order: number): QuestionV1 {
  return {
    id: newId("q"),
    type,
    order,
    label: DEFAULT_LABEL[type],
    required: type !== "welcome_screen" && type !== "statement",
    settings: defaultSettings(type),
  } as QuestionV1;
}

/** Reassigns `order` to match array position — call after any
 * insert/remove/move so `order` never drifts from the array's own
 * sequence (order is what the publish compiler and logic engine walk). */
function reindex(questions: QuestionV1[]): QuestionV1[] {
  return questions.map((q, i) => ({ ...q, order: i }));
}

export function insertQuestion(
  questions: QuestionV1[],
  question: QuestionV1,
  atIndex: number,
): QuestionV1[] {
  const next = [...questions];
  next.splice(atIndex, 0, question);
  return reindex(next);
}

export function removeQuestion(questions: QuestionV1[], id: string): QuestionV1[] {
  return reindex(questions.filter((q) => q.id !== id));
}

export function duplicateQuestion(questions: QuestionV1[], id: string): QuestionV1[] {
  const index = questions.findIndex((q) => q.id === id);
  if (index === -1) return questions;
  const copy: QuestionV1 = {
    ...questions[index],
    id: newId("q"),
    label: `${questions[index].label} (copy)`,
  };
  return insertQuestion(questions, copy, index + 1);
}

export function moveQuestion(
  questions: QuestionV1[],
  id: string,
  direction: "up" | "down",
): QuestionV1[] {
  const index = questions.findIndex((q) => q.id === id);
  if (index === -1) return questions;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= questions.length) return questions;

  const next = [...questions];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return reindex(next);
}

export function reorderQuestions(
  questions: QuestionV1[],
  fromIndex: number,
  toIndex: number,
): QuestionV1[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= questions.length ||
    toIndex >= questions.length
  ) {
    return questions;
  }
  const next = [...questions];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return reindex(next);
}
