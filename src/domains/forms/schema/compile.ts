import { FormSchemaError } from "./validate";
import type { FormSchemaV1 } from "./v1";

/**
 * A compiled form is what publish() persists and what the runtime/
 * preview consume — schema plus derived, precomputed graph data so
 * neither has to re-walk logic on every render.
 */
export type CompiledFormV1 = {
  schema: FormSchemaV1;
  orderedQuestionIds: string[];
  defaultEndingId: string;
};

type GraphEdge = { to: string | null; ruleId?: string };

function buildGraph(schema: FormSchemaV1): Map<string, GraphEdge[]> {
  const ordered = [...schema.questions].sort((a, b) => a.order - b.order);
  const defaultEnding = schema.endings.find((e) => e.isDefault)!;

  const graph = new Map<string, GraphEdge[]>();

  ordered.forEach((q, idx) => {
    const edges: GraphEdge[] = [];
    const nextQuestion = ordered[idx + 1];
    // Conservative default edge: what happens if no logic rule matches.
    edges.push({ to: nextQuestion ? nextQuestion.id : null });

    for (const rule of schema.logic) {
      if (rule.questionId !== q.id) continue;
      if (rule.action.type === "jump_to_question") {
        edges.push({ to: rule.action.questionId, ruleId: rule.id });
      } else {
        edges.push({ to: null, ruleId: rule.id }); // null = reaches an ending
      }
    }

    graph.set(q.id, edges);
  });

  void defaultEnding;
  return graph;
}

/**
 * Tarjan's SCC over the question-jump graph. Any strongly connected
 * component with no edge leaving it (to another question outside the
 * component, or to an ending) is a genuine infinite loop — every path
 * that enters it can never exit. We only reject those; ordinary
 * "jump backward then continue forward" logic always has an escape
 * edge (the default forward edge on at least one node) and is fine.
 */
function findInescapableCycles(graph: Map<string, GraphEdge[]>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(v: string) {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.set(v, true);

    for (const edge of graph.get(v) ?? []) {
      if (edge.to === null) continue;
      if (!indices.has(edge.to)) {
        strongConnect(edge.to);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(edge.to)!));
      } else if (onStack.get(edge.to)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(edge.to)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.set(w, false);
        component.push(w);
      } while (w !== v);
      sccs.push(component);
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) strongConnect(node);
  }

  const inescapable: string[][] = [];
  for (const component of sccs) {
    const isCycle =
      component.length > 1 ||
      (graph.get(component[0])?.some((e) => e.to === component[0]) ?? false);
    if (!isCycle) continue;

    const members = new Set(component);
    const hasEscape = component.some((node) =>
      (graph.get(node) ?? []).some((edge) => edge.to === null || !members.has(edge.to)),
    );
    if (!hasEscape) inescapable.push(component);
  }

  return inescapable;
}

/** Stage 4: publication validation/compilation. */
export function compileFormSchema(schema: FormSchemaV1): CompiledFormV1 {
  const ordered = [...schema.questions].sort((a, b) => a.order - b.order);
  const defaultEnding = schema.endings.find((e) => e.isDefault);
  if (!defaultEnding) {
    throw new FormSchemaError("no default ending set", "missing_default_ending", {
      message: "Endings: exactly one ending must be the default.",
    });
  }

  const graph = buildGraph(schema);
  const inescapable = findInescapableCycles(graph);
  if (inescapable.length > 0) {
    throw new FormSchemaError(
      `inescapable logic loop detected among questions: ${inescapable.map((c) => c.join(" -> ")).join(", ")}`,
      "inescapable_loop",
      {
        message: `Logic: questions ${inescapable[0]
          .map((id) => ordered.findIndex((q) => q.id === id) + 1)
          .sort((a, b) => a - b)
          .join(", ")} send respondents round in a circle they can never leave.`,
      },
    );
  }

  // Reachability from the first question — every question must be
  // reachable via the default order or some logic rule, otherwise it's
  // dead content a respondent could never see.
  const reachable = new Set<string>();
  const queue = ordered.length > 0 ? [ordered[0].id] : [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of graph.get(current) ?? []) {
      if (edge.to !== null) queue.push(edge.to);
    }
  }
  const unreachable = ordered.filter((q) => !reachable.has(q.id));
  if (unreachable.length > 0) {
    throw new FormSchemaError(
      `unreachable questions: ${unreachable.map((q) => q.id).join(", ")}`,
      "unreachable_question",
      {
        message: `Question ${ordered.indexOf(unreachable[0]) + 1} can never be reached, so respondents would never see it.`,
        questionId: unreachable[0].id,
      },
    );
  }

  return {
    schema,
    orderedQuestionIds: ordered.map((q) => q.id),
    defaultEndingId: defaultEnding.id,
  };
}
