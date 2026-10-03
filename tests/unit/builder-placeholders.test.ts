import { describe, expect, it } from "vitest";
import { createQuestion, questionsWithPlaceholders } from "@/domains/forms/builder";
import { starterFormSchema } from "@/domains/forms/queries";

/** The publish heads-up: starter wording that shouldn't reach respondents. */
describe("questionsWithPlaceholders", () => {
  it("finds untouched question text and options, in form order", () => {
    const choice = createQuestion("single_select", 2);
    const named = { ...createQuestion("short_text", 1), label: "Your name" };
    const statement = createQuestion("statement", 0);
    expect(
      questionsWithPlaceholders([choice, named, statement]).map((q) => q.id),
    ).toEqual([statement.id, choice.id]);
  });

  it("flags a renamed question that still has a starter option", () => {
    const choice = createQuestion("single_select", 0);
    const settings = choice.settings as { options: { id: string; label: string }[] };
    const renamed = {
      ...choice,
      label: "Which plan?",
      settings: {
        ...settings,
        options: [{ ...settings.options[0], label: "Free" }, settings.options[1]],
      },
    } as typeof choice;
    expect(questionsWithPlaceholders([renamed])).toHaveLength(1);
    const done = {
      ...renamed,
      settings: {
        ...settings,
        options: settings.options.map((o, i) => ({ ...o, label: ["Free", "Pro"][i] })),
      },
    } as typeof choice;
    expect(questionsWithPlaceholders([done])).toEqual([]);
  });

  it("leaves sensible defaults alone, and flags an unnamed form's welcome screen", () => {
    // "What's your email?" is a fine question as it stands.
    expect(questionsWithPlaceholders([createQuestion("email", 0)])).toEqual([]);
    const unnamed = starterFormSchema("Untitled form").questions;
    expect(questionsWithPlaceholders(unnamed).map((q) => q.type)).toEqual([
      "welcome_screen",
    ]);
    expect(
      questionsWithPlaceholders(starterFormSchema("Customer intake").questions),
    ).toEqual([]);
  });
});
