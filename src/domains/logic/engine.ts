import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type {
  ActionV1,
  CompareOperator,
  RuleV1,
  Value,
  VariableV1,
} from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1, LogicRuleV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { evaluateCondition } from "./conditions";
import { asDate, asNumber, evaluateExpr, todayIn, type ExprContext } from "./expressions";

/**
 * The logic engine (docs/logic-engine.md §2). One deterministic,
 * side-effect-free interpreter used by the builder's Preview and
 * simulator, the public form, and the server at submission — so what a
 * creator tests is exactly what respondents get and what the server
 * enforces.
 */

export type AnswerMap = Record<string, unknown>;

export type NextStep =
  { type: "question"; questionId: string } | { type: "ending"; endingId: string };

export type TraceEntry =
  | { kind: "question_shown"; questionId: string }
  | { kind: "question_skipped"; questionId: string }
  | { kind: "rule_matched"; ruleId: string }
  | { kind: "rule_not_matched"; ruleId: string }
  | {
      kind: "variable_changed";
      variableId: string;
      from: Value;
      to: Value;
      ruleId?: string;
      questionId?: string;
      optionId?: string;
    }
  | { kind: "jump"; ruleId: string; to: NextStep }
  | {
      kind: "ending";
      endingId: string;
      ruleId?: string;
      reason: "rule" | "highest" | "default";
    }
  | { kind: "warning"; message: string; ruleId?: string };

export type EngineOptions = {
  /** Values from the form's URL; only declared hidden fields are read. */
  hidden?: Record<string, string | undefined>;
  /** The clock for date logic; pin it to replay a past evaluation. */
  now?: Date;
};

export type EngineState = {
  variables: Record<string, Value>;
  trace: TraceEntry[];
};

const MAX_TRACE = 2000;

/** Engine rules = legacy `logic` (translated) then `rules`, in order. */
type NormalizedRule = RuleV1 & { legacy?: boolean };

type Run = {
  compiled: CompiledFormV1;
  schema: FormSchemaV1;
  answers: AnswerMap;
  ctxBase: Omit<ExprContext, "variables">;
  rules: NormalizedRule[];
  variables: Map<string, VariableV1>;
  questions: Map<string, QuestionV1>;
};

// --- rule normalisation ------------------------------------------------------

const LEGACY_OPERATOR: Record<LogicRuleV1["operator"], CompareOperator> = {
  equals: "eq",
  not_equals: "neq",
  contains: "contains",
  gt: "gt",
  lt: "lt",
  is_answered: "is_not_empty",
  is_not_answered: "is_empty",
};

/** A legacy single-question rule, expressed in the rule model. */
export function legacyToRule(rule: LogicRuleV1): NormalizedRule {
  const op = LEGACY_OPERATOR[rule.operator];
  const needsValue =
    rule.operator !== "is_answered" && rule.operator !== "is_not_answered";
  return {
    id: rule.id,
    legacy: true,
    on: { event: "question_answered", questionId: rule.questionId },
    when: {
      type: "compare",
      left: { type: "answer", questionId: rule.questionId },
      op,
      right: needsValue
        ? { type: "literal", value: (rule.value ?? null) as Value }
        : undefined,
    },
    then: [rule.action],
  };
}

const ruleCache = new WeakMap<FormSchemaV1, NormalizedRule[]>();

export function normalizedRules(schema: FormSchemaV1): NormalizedRule[] {
  const cached = ruleCache.get(schema);
  if (cached) return cached;
  const rules = [
    ...schema.logic.map(legacyToRule),
    ...(schema.rules ?? []).filter((r) => !r.disabled),
  ];
  ruleCache.set(schema, rules);
  return rules;
}

// --- context -------------------------------------------------------------------

function resolveHidden(
  schema: FormSchemaV1,
  provided: Record<string, string | undefined> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of schema.hiddenFields ?? []) {
    const raw = provided[field.name];
    const value = typeof raw === "string" && raw !== "" ? raw : field.default;
    if (value !== undefined) out[field.name] = value.slice(0, 500);
  }
  return out;
}

function createRun(
  compiled: CompiledFormV1,
  answers: AnswerMap,
  options: EngineOptions,
): Run {
  const schema = compiled.schema;
  return {
    compiled,
    schema,
    answers,
    ctxBase: {
      answers,
      hidden: resolveHidden(schema, options.hidden),
      today: todayIn(options.now ?? new Date(), schema.meta.timezone),
    },
    rules: normalizedRules(schema),
    variables: new Map((schema.variables ?? []).map((v) => [v.id, v])),
    questions: new Map(schema.questions.map((q) => [q.id, q])),
  };
}

function ctxOf(run: Run, state: EngineState): ExprContext {
  return { ...run.ctxBase, variables: state.variables };
}

function trace(state: EngineState, entry: TraceEntry) {
  if (state.trace.length < MAX_TRACE) state.trace.push(entry);
}

// --- variables -------------------------------------------------------------------

function defaultFor(variable: VariableV1): Value {
  if (variable.initial !== undefined) return coerce(variable, variable.initial) ?? null;
  switch (variable.type) {
    case "number":
      return 0;
    case "list":
      return [];
    case "string":
      return "";
    case "boolean":
      return false;
    case "date":
      return null;
  }
}

/** A value made fit for a variable's type, or undefined if it can't be. */
function coerce(variable: VariableV1, v: Value): Value | undefined {
  if (v === null) return variable.type === "list" ? [] : null;
  switch (variable.type) {
    case "number":
      return asNumber(v) ?? undefined;
    case "string":
      return Array.isArray(v) ? v.join(", ") : String(v);
    case "boolean":
      return typeof v === "boolean" ? v : undefined;
    case "date":
      return asDate(v) ?? undefined;
    case "list":
      return Array.isArray(v) ? v : typeof v === "boolean" ? [String(v)] : [v];
  }
}

function setVariable(
  run: Run,
  state: EngineState,
  action: Extract<ActionV1, { type: "set_variable" }>,
  cause: { ruleId?: string },
) {
  const variable = run.variables.get(action.variableId);
  if (!variable) {
    trace(state, {
      kind: "warning",
      message: `Unknown variable ${action.variableId}`,
      ...cause,
    });
    return;
  }
  const current = state.variables[variable.id] ?? defaultFor(variable);
  const value = evaluateExpr(action.value, ctxOf(run, state));
  let next: Value | undefined;

  switch (action.op) {
    case "set":
      next = coerce(variable, value);
      break;
    case "add":
    case "subtract":
    case "multiply":
    case "divide": {
      if (variable.type === "string" && action.op === "add") {
        next = `${current ?? ""}${value ?? ""}`;
        break;
      }
      const a = asNumber(current) ?? 0;
      const b = asNumber(value);
      if (b === null || variable.type !== "number") break;
      if (action.op === "divide" && b === 0) {
        trace(state, {
          kind: "warning",
          message: `Skipped dividing ${variable.name} by zero`,
          ...cause,
        });
        return;
      }
      const result =
        action.op === "add"
          ? a + b
          : action.op === "subtract"
            ? a - b
            : action.op === "multiply"
              ? a * b
              : a / b;
      next = Number.isFinite(result) ? result : undefined;
      break;
    }
    case "append":
    case "remove": {
      const list = Array.isArray(current) ? current : [];
      const items = value === null ? [] : Array.isArray(value) ? value : [String(value)];
      next =
        action.op === "append"
          ? [...list, ...items]
          : list.filter((x) => !items.some((i) => String(i) === String(x)));
      break;
    }
  }

  if (next === undefined) {
    trace(state, {
      kind: "warning",
      message: `Couldn't ${action.op} ${variable.name}: the value doesn't fit a ${variable.type}`,
      ...cause,
    });
    return;
  }
  state.variables = { ...state.variables, [variable.id]: next };
  trace(state, {
    kind: "variable_changed",
    variableId: variable.id,
    from: current,
    to: next,
    ...cause,
  });
}

/** Points from the chosen options (and the question's weight). */
function applyOptionScores(run: Run, state: EngineState, question: QuestionV1) {
  const options = (question.settings as { options?: QuestionOption[] }).options;
  if (!options?.some((o) => o.scores?.length)) return;
  const answer = run.answers[question.id];
  const chosen = new Set(
    (Array.isArray(answer) ? answer : [answer]).filter((v) => typeof v === "string"),
  );
  const weight = question.weight ?? 1;
  for (const option of options) {
    if (!chosen.has(option.id)) continue;
    for (const score of option.scores ?? []) {
      setVariable(
        run,
        state,
        {
          type: "set_variable",
          variableId: score.variableId,
          op: "add",
          value: { type: "literal", value: score.points * weight },
        },
        {},
      );
      const last = state.trace[state.trace.length - 1];
      if (last?.kind === "variable_changed") {
        last.questionId = question.id;
        last.optionId = option.id;
      }
    }
  }
}

type QuestionOption = { id: string; scores?: { variableId: string; points: number }[] };

// --- rules -------------------------------------------------------------------------

/** Runs every matching rule's variable actions; returns the first
 * navigation any of them asks for (legacy-compatible "first match wins"). */
function runRules(
  run: Run,
  state: EngineState,
  rules: NormalizedRule[],
  visited: ReadonlySet<string>,
  allowQuestionJumps: boolean,
): (NextStep & { ruleId: string }) | null {
  let navigation: (NextStep & { ruleId: string }) | null = null;
  for (const rule of rules) {
    const matched = !rule.when || evaluateCondition(rule.when, ctxOf(run, state));
    if (!matched) {
      trace(state, { kind: "rule_not_matched", ruleId: rule.id });
      continue;
    }
    trace(state, { kind: "rule_matched", ruleId: rule.id });
    for (const action of rule.then) {
      if (action.type === "set_variable") {
        setVariable(run, state, action, { ruleId: rule.id });
        continue;
      }
      if (navigation) continue;
      if (action.type === "jump_to_ending") {
        navigation = { type: "ending", endingId: action.endingId, ruleId: rule.id };
      } else if (action.type === "go_to_highest") {
        navigation = {
          type: "ending",
          endingId: highest(run, state, action),
          ruleId: rule.id,
        };
      } else if (action.type === "jump_to_question") {
        if (!allowQuestionJumps) {
          trace(state, {
            kind: "warning",
            message: "A question jump can't run after the last question",
            ruleId: rule.id,
          });
        } else if (visited.has(action.questionId)) {
          // Jumps only go forward; one that would revisit is ignored so a
          // legacy backward rule can never loop a respondent.
          trace(state, {
            kind: "warning",
            message: "Ignored a jump back to a question already shown",
            ruleId: rule.id,
          });
        } else {
          navigation = {
            type: "question",
            questionId: action.questionId,
            ruleId: rule.id,
          };
        }
      }
    }
  }
  return navigation;
}

function highest(
  run: Run,
  state: EngineState,
  action: Extract<ActionV1, { type: "go_to_highest" }>,
): string {
  let best = action.candidates[0];
  let bestScore = -Infinity;
  for (const candidate of action.candidates) {
    const score = asNumber(state.variables[candidate.variableId] ?? null) ?? -Infinity;
    // Strictly greater: a tie keeps the earlier candidate (list order = priority).
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best.endingId;
}

function rulesFor(run: Run, trigger: RuleV1["on"]): NormalizedRule[] {
  return run.rules.filter((r) =>
    trigger.event === "question_answered"
      ? r.on.event === "question_answered" && r.on.questionId === trigger.questionId
      : r.on.event === trigger.event,
  );
}

// --- visibility & order ---------------------------------------------------------------

function isQuestionVisible(run: Run, state: EngineState, question: QuestionV1): boolean {
  return !question.visibleIf || evaluateCondition(question.visibleIf, ctxOf(run, state));
}

/** The first question at or after `fromIndex` that hasn't been shown and
 * is visible now; hidden ones on the way are recorded as skipped. */
function nextVisible(
  run: Run,
  state: EngineState,
  fromIndex: number,
  visited: ReadonlySet<string>,
): string | null {
  const ordered = run.compiled.orderedQuestionIds;
  for (let i = Math.max(0, fromIndex); i < ordered.length; i += 1) {
    const id = ordered[i];
    if (visited.has(id)) continue;
    const question = run.questions.get(id);
    if (!question) continue;
    if (isQuestionVisible(run, state, question)) return id;
    trace(state, { kind: "question_skipped", questionId: id });
  }
  return null;
}

// --- lifecycle ---------------------------------------------------------------------------

function startState(run: Run): EngineState {
  const state: EngineState = { variables: {}, trace: [] };
  for (const variable of run.variables.values()) {
    state.variables[variable.id] = defaultFor(variable);
  }
  runRules(run, state, rulesFor(run, { event: "form_started" }), new Set(), false);
  return state;
}

/** Leaving a question: its option scores, then its rules. */
function leave(
  run: Run,
  state: EngineState,
  questionId: string,
  visited: ReadonlySet<string>,
): (NextStep & { ruleId: string }) | null {
  const question = run.questions.get(questionId);
  if (question) applyOptionScores(run, state, question);
  return runRules(
    run,
    state,
    rulesFor(run, { event: "question_answered", questionId }),
    visited,
    true,
  );
}

/** Where to go after leaving `questionId`, given any rule navigation. */
function resolveNext(
  run: Run,
  state: EngineState,
  questionId: string,
  navigation: (NextStep & { ruleId: string }) | null,
  visited: ReadonlySet<string>,
): NextStep {
  if (navigation?.type === "ending") {
    return { type: "ending", endingId: finish(run, state, navigation) };
  }
  const ordered = run.compiled.orderedQuestionIds;
  if (navigation?.type === "question") {
    trace(state, { kind: "jump", ruleId: navigation.ruleId, to: navigation });
    // A jump to a question that's hidden right now lands on the next
    // visible one after it.
    const target = nextVisible(
      run,
      state,
      ordered.indexOf(navigation.questionId),
      visited,
    );
    if (target) return { type: "question", questionId: target };
    return { type: "ending", endingId: finish(run, state, null) };
  }
  const next = nextVisible(run, state, ordered.indexOf(questionId) + 1, visited);
  if (next) return { type: "question", questionId: next };
  return { type: "ending", endingId: finish(run, state, null) };
}

/** Completion rules always run their variable actions; their navigation
 * only picks the ending if a question rule didn't already. */
function finish(
  run: Run,
  state: EngineState,
  chosen: (NextStep & { ruleId: string }) | null,
): string {
  const completion = runRules(
    run,
    state,
    rulesFor(run, { event: "form_completed" }),
    new Set(),
    false,
  );
  const pick = chosen ?? completion;
  const endings = run.schema.endings;
  if (pick?.type === "ending" && endings.some((e) => e.id === pick.endingId)) {
    const reason = run.rules
      .find((r) => r.id === pick.ruleId)
      ?.then.some((a) => a.type === "go_to_highest")
      ? "highest"
      : "rule";
    trace(state, {
      kind: "ending",
      endingId: pick.endingId,
      ruleId: pick.ruleId,
      reason,
    });
    return pick.endingId;
  }
  trace(state, {
    kind: "ending",
    endingId: run.compiled.defaultEndingId,
    reason: "default",
  });
  return run.compiled.defaultEndingId;
}

// --- public API ----------------------------------------------------------------------------

export type WalkResult = {
  visitedQuestionIds: string[];
  endingId: string;
  variables: Record<string, Value>;
  trace: TraceEntry[];
  /** Conditional / cross-field checks that failed, on the path taken. */
  validationErrors: { questionId: string; message: string }[];
};

/** The first question a respondent sees (hidden ones are skipped). */
export function firstQuestionId(
  compiled: CompiledFormV1,
  answers: AnswerMap = {},
  options: EngineOptions = {},
): string | null {
  const run = createRun(compiled, answers, options);
  return nextVisible(run, startState(run), 0, new Set());
}

/**
 * Walks the form from the start to an ending with a full set of answers.
 * The server's authority at submission: which questions were on the path
 * (only those are validated and stored), which ending was reached, and
 * the final variables — never trusted from the client.
 */
export function walkForm(
  compiled: CompiledFormV1,
  answers: AnswerMap,
  options: EngineOptions = {},
): WalkResult {
  const run = createRun(compiled, answers, options);
  const state = startState(run);
  const visited: string[] = [];
  const seen = new Set<string>();
  const validationErrors: WalkResult["validationErrors"] = [];

  let current = nextVisible(run, state, 0, seen);
  let endingId: string | null = null;
  // Each step visits a new question, so this always terminates.
  for (
    let guard = 0;
    current && guard <= compiled.orderedQuestionIds.length;
    guard += 1
  ) {
    seen.add(current);
    visited.push(current);
    trace(state, { kind: "question_shown", questionId: current });
    const message = failedValidation(run, state, current);
    if (message) validationErrors.push({ questionId: current, message });

    const next = resolveNext(run, state, current, leave(run, state, current, seen), seen);
    if (next.type === "ending") {
      endingId = next.endingId;
      break;
    }
    current = next.questionId;
  }
  if (!endingId) endingId = finish(run, state, null);

  return {
    visitedQuestionIds: visited,
    endingId,
    variables: state.variables,
    trace: state.trace,
    validationErrors,
  };
}

/** Replays `path` (questions shown so far, in order) and returns the
 * state before leaving its last question — what that question's recall
 * and checks see. */
export function stateAt(
  compiled: CompiledFormV1,
  answers: AnswerMap,
  path: readonly string[],
  options: EngineOptions = {},
): EngineState {
  const run = createRun(compiled, answers, options);
  const state = startState(run);
  const seen = new Set<string>();
  for (const id of path.slice(0, -1)) {
    seen.add(id);
    leave(run, state, id, seen);
  }
  return state;
}

/**
 * Where to go after the last question in `path`. The runtime calls this
 * on every step; it replays the earlier questions so variables and
 * scores are always derived from the answers, never accumulated.
 */
export function nextStepFor(
  compiled: CompiledFormV1,
  answers: AnswerMap,
  path: readonly string[],
  options: EngineOptions = {},
): { next: NextStep; state: EngineState } {
  const run = createRun(compiled, answers, options);
  const state = startState(run);
  const seen = new Set<string>();
  for (const id of path.slice(0, -1)) {
    seen.add(id);
    leave(run, state, id, seen);
  }
  const current = path[path.length - 1];
  seen.add(current);
  const next = resolveNext(run, state, current, leave(run, state, current, seen), seen);
  return { next, state };
}

/** The current question's conditional / cross-field validation message,
 * or null if it passes. */
export function questionLogicError(
  compiled: CompiledFormV1,
  answers: AnswerMap,
  path: readonly string[],
  options: EngineOptions = {},
): string | null {
  const run = createRun(compiled, answers, options);
  const state = stateAt(compiled, answers, path, options);
  return failedValidation(run, state, path[path.length - 1]);
}

function failedValidation(
  run: Run,
  state: EngineState,
  questionId: string,
): string | null {
  const question = run.questions.get(questionId);
  for (const check of question?.validations ?? []) {
    const ctx = ctxOf(run, state);
    if (check.when && !evaluateCondition(check.when, ctx)) continue;
    if (!evaluateCondition(check.check, ctx)) return check.message;
  }
  return null;
}

/** For the simulator and analysis: the run context's resolved inputs. */
export function engineInputs(compiled: CompiledFormV1, options: EngineOptions = {}) {
  const run = createRun(compiled, {}, options);
  return { hidden: run.ctxBase.hidden, today: run.ctxBase.today };
}
