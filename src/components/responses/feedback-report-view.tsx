import { ShieldCheck } from "lucide-react";
import type { FeedbackReport } from "@/domains/responses/feedback-report";

const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(1));

/** The confidential feedback report (F-30): averages and comments only. */
export function FeedbackReportView({ report }: { report: FeedbackReport }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="bg-card border-ink flex items-start gap-2.5 rounded-lg border-[1.5px] px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <span>
          Confidential: individual responses can&apos;t be opened or exported. Groups of
          fewer than {report.threshold} raters are never shown on their own.
        </span>
      </p>
      {!report.shown ? (
        <p className="text-muted-foreground text-sm">
          {report.responses === 0
            ? "No responses yet."
            : `The report appears once ${report.threshold} people have responded (${report.responses} so far).`}
        </p>
      ) : (
        <>
          <p className="text-sm">
            <b>{report.responses}</b> responses
            {report.groups.length > 0 &&
              ` · ${report.groups.map((g) => `${g.label} (${g.responses})`).join(", ")}`}
          </p>
          {report.scores.length > 0 && (
            <section aria-labelledby="fr-scores" className="flex flex-col gap-2">
              <h2 id="fr-scores" className="font-heading text-lg font-bold">
                Average ratings
              </h2>
              <div className="border-ink bg-card overflow-x-auto rounded-lg border-[1.5px]">
                <table className="w-max min-w-full text-sm">
                  <thead>
                    <tr className="border-ink border-b-[1.5px] text-left text-xs">
                      <th scope="col" className="px-3 py-2 font-bold">
                        Question
                      </th>
                      <th scope="col" className="px-3 py-2 font-bold">
                        Everyone
                      </th>
                      {report.groups.map((g) => (
                        <th key={g.label} scope="col" className="px-3 py-2 font-bold">
                          {g.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.scores.map((s) => (
                      <tr
                        key={s.questionId}
                        className="border-border border-b last:border-b-0"
                      >
                        <th
                          scope="row"
                          className="max-w-[320px] px-3 py-2 text-left font-semibold"
                        >
                          {s.label}
                          <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                            {s.scale}
                          </span>
                        </th>
                        <td className="px-3 py-2 tabular-nums">{fmt(s.overall)}</td>
                        {s.byGroup.map((v, i) => (
                          <td key={i} className="px-3 py-2 tabular-nums">
                            {fmt(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {report.choices.filter((c) => c.bars.length).length > 0 && (
            <section aria-labelledby="fr-choices" className="flex flex-col gap-2">
              <h2 id="fr-choices" className="font-heading text-lg font-bold">
                Choices
              </h2>
              {report.choices
                .filter((c) => c.bars.length)
                .map((c) => (
                  <div key={c.questionId} className="text-sm">
                    <b>{c.label}</b>
                    <span className="text-muted-foreground">
                      {" "}
                      · {c.bars.map((b) => `${b.label} ${b.percent}%`).join(" · ")}
                    </span>
                  </div>
                ))}
            </section>
          )}
          {report.comments.filter((c) => c.texts.length).length > 0 && (
            <section aria-labelledby="fr-comments" className="flex flex-col gap-3">
              <h2 id="fr-comments" className="font-heading text-lg font-bold">
                Comments
              </h2>
              {report.comments
                .filter((c) => c.texts.length)
                .map((c) => (
                  <div key={c.questionId} className="flex flex-col gap-1.5">
                    <b className="text-sm">{c.label}</b>
                    <ul className="flex flex-col gap-1.5">
                      {c.texts.map((text, i) => (
                        <li
                          key={i}
                          className="bg-card border-border rounded-sm border px-3 py-2 text-sm whitespace-pre-wrap"
                        >
                          {text}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
