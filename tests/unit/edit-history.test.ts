import { describe, expect, it } from "vitest";
import { createEditHistory, STEP_GAP_MS } from "@/components/builder/edit-history";

describe("the builder's undo history (QA FC4-22)", () => {
  it("undoes and redoes whole steps, in order", () => {
    const history = createEditHistory<string>();
    history.record("a", 0); // a → b
    history.record("b", STEP_GAP_MS * 2); // b → c
    expect(history.snapshot()).toBe("2:0");
    expect(history.undo("c")).toBe("b");
    expect(history.undo("b")).toBe("a");
    expect(history.undo("a")).toBeNull();
    expect(history.redo("a")).toBe("b");
    expect(history.redo("b")).toBe("c");
    expect(history.redo("c")).toBeNull();
  });

  it("makes a burst of changes (typing) one step", () => {
    const history = createEditHistory<string>();
    history.record("", 0); // "" → "H"
    history.record("H", 100); // "H" → "Hi"
    history.record("Hi", 200); // "Hi" → "Hi!"
    expect(history.snapshot()).toBe("1:0");
    expect(history.undo("Hi!")).toBe("");
  });

  it("forgets what could be redone once something new is changed", () => {
    const history = createEditHistory<string>();
    history.record("a", 0);
    expect(history.undo("b")).toBe("a");
    history.record("a", STEP_GAP_MS * 3); // a → x, a new branch
    expect(history.snapshot()).toBe("1:0");
    expect(history.redo("x")).toBeNull();
  });
});
