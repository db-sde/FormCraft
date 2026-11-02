import { Download } from "lucide-react";
import type { CrossTab } from "@/domains/responses/crosstab";

/**
 * A cross-tab (F-30): pick a question for the rows and one for the
 * columns. A plain GET form, so it works without scripts and the URL is
 * shareable; the CSV link exports exactly this table.
 */
export function CrossTabView({
  action,
  hidden,
  questions,
  rowId,
  columnId,
  table,
  csvHref,
}: {
  action: string;
  hidden: Record<string, string>;
  questions: { id: string; label: string }[];
  rowId: string | undefined;
  columnId: string | undefined;
  table: CrossTab | null;
  csvHref: string;
}) {
  if (questions.length < 2) {
    return (
      <p className="text-muted-foreground text-sm">
        Cross-tabs compare two choice, yes/no, rating or scale questions. This form needs
        at least two of them.
      </p>
    );
  }
  const select = (name: "x" | "y", label: string, value: string | undefined) => (
    <label className="flex flex-col gap-1 text-[13px] font-semibold">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="border-input bg-field h-9 max-w-[320px] rounded-sm border-[1.5px] px-2 font-normal"
      >
        {questions.map((q) => (
          <option key={q.id} value={q.id}>
            {q.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section aria-label="Cross-tab" className="flex flex-col gap-3.5">
      <form method="get" action={action} className="flex flex-wrap items-end gap-3">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {select("x", "Rows", rowId)}
        {select("y", "Columns", columnId)}
        <button
          type="submit"
          className="border-ink bg-card fc-focus h-9 rounded-sm border-[1.5px] px-3 text-sm font-semibold"
        >
          Show
        </button>
        {table && (
          <a
            href={csvHref}
            className="fc-focus ml-auto inline-flex h-9 items-center gap-1.5 text-sm font-semibold underline-offset-2 hover:underline"
          >
            <Download className="size-4" />
            Download CSV
          </a>
        )}
      </form>
      {table && (
        <>
          <div className="border-ink bg-card overflow-x-auto rounded-lg border-[1.5px]">
            <table className="w-max min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-ink border-b-[1.5px] text-left">
                  <th scope="col" className="px-3 py-2 text-xs font-bold">
                    <span className="sr-only">Rows by columns</span>
                  </th>
                  {table.columns.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-2 text-xs font-bold">
                      {c.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-xs font-bold">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={r.key} className="border-border border-b">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">
                      {r.label}
                    </th>
                    {table.cells[i].map((n, j) => (
                      <td key={j} className="px-3 py-2 tabular-nums">
                        {n}
                        {table.rowTotals[i] > 0 && n > 0 && (
                          <span className="text-muted-foreground ml-1 text-xs">
                            {Math.round((n / table.rowTotals[i]) * 100)}%
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 font-semibold tabular-nums">
                      {table.rowTotals[i]}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="px-3 py-2 text-left font-bold">
                    Total
                  </th>
                  {table.columnTotals.map((n, j) => (
                    <td key={j} className="px-3 py-2 font-semibold tabular-nums">
                      {n}
                    </td>
                  ))}
                  <td className="px-3 py-2 font-bold tabular-nums">
                    {table.rowTotals.reduce((s, n) => s + n, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-xs">
            {table.responses.toLocaleString()} completed responses
            {table.multiCounted
              ? ". A checkbox question counts a response once for each option it chose, so totals can be higher"
              : ", each counted once"}
            . Percentages are of each row.
            {table.capped && " Based on the newest 2,000 matching responses."}
          </p>
        </>
      )}
    </section>
  );
}
