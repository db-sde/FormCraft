/**
 * Logic-engine benchmarks (spec phase 36): how long the engine takes on
 * forms far bigger than real ones.
 *
 *   npm run bench:logic
 *
 * Reports the median of several runs for: one server walk (what a
 * submission costs), one "next step" at the end of the form (the most a
 * single click costs in the browser, since each step replays the path),
 * a whole session (every step of the form in turn), and replaying 2,000
 * responses (what the Summary's Results does at its cap).
 */
import { performance } from "node:perf_hooks";
import { nextStepFor, walkForm } from "../src/domains/logic";
import { syntheticForm } from "../tests/support/synthetic-form";

function median(run: () => void, times = 7): number {
  run(); // warm up
  const samples = Array.from({ length: times }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const ms = (n: number) => `${n.toFixed(2)} ms`.padStart(12);

console.log(
  "questions × rules".padEnd(20),
  "walk".padStart(12),
  "last step".padStart(12),
  "session".padStart(12),
  "2,000 walks".padStart(14),
);
for (const [questions, rulesPerQuestion] of [
  [20, 1],
  [50, 2],
  [100, 2],
  [200, 1],
  [100, 5],
] as const) {
  const { compiled, answers } = syntheticForm(questions, rulesPerQuestion);
  const path = walkForm(compiled, answers).visitedQuestionIds;
  const walk = median(() => walkForm(compiled, answers));
  const lastStep = median(() => nextStepFor(compiled, answers, path));
  const session = median(() => {
    for (let i = 1; i <= path.length; i += 1)
      nextStepFor(compiled, answers, path.slice(0, i));
  }, 3);
  const replay = median(() => {
    for (let i = 0; i < 2000; i += 1) walkForm(compiled, answers);
  }, 3);
  console.log(
    `${questions} × ${questions * rulesPerQuestion}`.padEnd(20),
    ms(walk),
    ms(lastStep),
    ms(session),
    ms(replay).padStart(14),
  );
}
