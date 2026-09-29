import { describe, expect, it } from "vitest";
import {
  createQuestion,
  createOption,
  insertQuestion,
  removeQuestion,
  duplicateQuestion,
  moveQuestion,
  reorderQuestions,
  canDeleteQuestion,
} from "@/domains/forms/builder";
import type { QuestionV1 } from "@/domains/forms/schema/v1";

function threeQuestions(): QuestionV1[] {
  return [
    createQuestion("short_text", 0),
    createQuestion("email", 1),
    createQuestion("number", 2),
  ];
}

describe("createQuestion", () => {
  it("generates a unique, schema-valid id for each call", () => {
    const a = createQuestion("short_text", 0);
    const b = createQuestion("short_text", 0);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("defaults required to true for answerable types, false for screens", () => {
    expect(createQuestion("short_text", 0).required).toBe(true);
    expect(createQuestion("welcome_screen", 0).required).toBe(false);
    expect(createQuestion("statement", 0).required).toBe(false);
  });

  it("seeds option-bearing types with starter options", () => {
    const q = createQuestion("single_select", 0);
    expect(q.type).toBe("single_select");
    if (q.type === "single_select") {
      expect(q.settings.options).toHaveLength(2);
    }
  });
});

describe("createOption", () => {
  it("generates unique ids", () => {
    expect(createOption("A").id).not.toBe(createOption("A").id);
  });
});

describe("insertQuestion / removeQuestion", () => {
  it("inserts at the given index and reindexes order to match position", () => {
    const questions = threeQuestions();
    const inserted = insertQuestion(questions, createQuestion("date", 0), 1);
    expect(inserted.map((q) => q.type)).toEqual([
      "short_text",
      "date",
      "email",
      "number",
    ]);
    expect(inserted.map((q) => q.order)).toEqual([0, 1, 2, 3]);
  });

  it("removes by id and reindexes remaining order", () => {
    const questions = threeQuestions();
    const targetId = questions[1].id;
    const result = removeQuestion(questions, targetId);
    expect(result).toHaveLength(2);
    expect(result.find((q) => q.id === targetId)).toBeUndefined();
    expect(result.map((q) => q.order)).toEqual([0, 1]);
  });
});

describe("duplicateQuestion", () => {
  it("inserts a copy immediately after the original with a new id", () => {
    const questions = threeQuestions();
    const originalId = questions[0].id;
    const result = duplicateQuestion(questions, originalId);
    expect(result).toHaveLength(4);
    expect(result[0].id).toBe(originalId);
    expect(result[1].id).not.toBe(originalId);
    expect(result[1].label).toContain("(copy)");
    expect(result.map((q) => q.order)).toEqual([0, 1, 2, 3]);
  });

  it("is a no-op for an unknown id", () => {
    const questions = threeQuestions();
    expect(duplicateQuestion(questions, "does_not_exist")).toBe(questions);
  });
});

describe("moveQuestion", () => {
  it("swaps with the previous question on 'up'", () => {
    const questions = threeQuestions();
    const secondId = questions[1].id;
    const result = moveQuestion(questions, secondId, "up");
    expect(result.map((q) => q.id)).toEqual([secondId, questions[0].id, questions[2].id]);
  });

  it("swaps with the next question on 'down'", () => {
    const questions = threeQuestions();
    const firstId = questions[0].id;
    const result = moveQuestion(questions, firstId, "down");
    expect(result.map((q) => q.id)).toEqual([questions[1].id, firstId, questions[2].id]);
  });

  it("is a no-op at the boundaries", () => {
    const questions = threeQuestions();
    expect(moveQuestion(questions, questions[0].id, "up")).toEqual(questions);
    expect(moveQuestion(questions, questions[2].id, "down")).toEqual(questions);
  });
});

describe("reorderQuestions", () => {
  it("moves a question from one index to another and reindexes", () => {
    const questions = threeQuestions();
    const result = reorderQuestions(questions, 0, 2);
    expect(result.map((q) => q.id)).toEqual([
      questions[1].id,
      questions[2].id,
      questions[0].id,
    ]);
    expect(result.map((q) => q.order)).toEqual([0, 1, 2]);
  });

  it("is a no-op for out-of-range indices", () => {
    const questions = threeQuestions();
    expect(reorderQuestions(questions, 0, 99)).toBe(questions);
  });
});

describe("welcome screen pinning", () => {
  function withWelcome(): QuestionV1[] {
    return insertQuestion(threeQuestions(), createQuestion("welcome_screen", 0), 0);
  }

  it("always inserts a welcome screen first, and at most once", () => {
    const questions = insertQuestion(
      threeQuestions(),
      createQuestion("welcome_screen", 0),
      2,
    );
    expect(questions[0].type).toBe("welcome_screen");
    expect(questions.map((q) => q.order)).toEqual([0, 1, 2, 3]);
    expect(insertQuestion(questions, createQuestion("welcome_screen", 0), 0)).toBe(
      questions,
    );
  });

  it("never places a regular question above the welcome screen", () => {
    const result = insertQuestion(withWelcome(), createQuestion("date", 0), 0);
    expect(result[0].type).toBe("welcome_screen");
    expect(result[1].type).toBe("date");
  });

  it("can't move the welcome screen, or move anything above it", () => {
    const questions = withWelcome();
    expect(moveQuestion(questions, questions[0].id, "down")).toBe(questions);
    expect(moveQuestion(questions, questions[1].id, "up")).toBe(questions);
    expect(reorderQuestions(questions, 2, 0)).toBe(questions);
    expect(reorderQuestions(questions, 0, 2)).toBe(questions);
  });

  it("doesn't duplicate the welcome screen", () => {
    const questions = withWelcome();
    expect(duplicateQuestion(questions, questions[0].id)).toBe(questions);
  });

  it("allows deleting anything except the last remaining question", () => {
    const questions = withWelcome();
    expect(canDeleteQuestion(questions, questions[0].id)).toBe(true);
    expect(canDeleteQuestion([questions[1]], questions[1].id)).toBe(false);
  });
});
