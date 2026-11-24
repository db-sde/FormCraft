import type { Metadata } from "next";
import Link from "next/link";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { LocalTime } from "@/components/local-time";

export const metadata: Metadata = { title: "Forms" };

type Row = {
  id: string;
  title: string;
  slug: string;
  state: "draft" | "live" | "closed";
  responses: number;
  last_response_at: string | null;
  updated_at: string;
  workspace_id: string;
  workspace_name: string;
  workspace_status: string;
};

/** Every form on the platform (ADM-050), without questions or answers. */
export default async function FormsInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; page?: string }>;
}) {
  await requireStaff("customers.read");
  const { q = "", state, page = "0" } = await searchParams;
  const st = state && ["draft", "live", "closed"].includes(state) ? state : null;
  const offset = Math.max(0, Number.parseInt(page, 10) || 0) * 50;
  const result = await adminCall<{ forms: Row[] }>("admin_form_inventory", {
    p_query: q.trim().slice(0, 120) || null,
    p_state: st,
    p_limit: 50,
    p_offset: offset,
  });
  const forms = result.ok ? result.forms : [];
  const qs = (next: Record<string, string | null>) =>
    "/admin/forms?" +
    new URLSearchParams(
      Object.entries({ q, state: st, ...next }).filter(([, v]) => v) as [
        string,
        string,
      ][],
    ).toString();
  return (
    <main className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">Forms</h1>
      <form className="flex flex-wrap gap-2" action="/admin/forms">
        <label htmlFor="form-search" className="sr-only">
          Search forms
        </label>
        <input
          id="form-search"
          name="q"
          defaultValue={q}
          maxLength={120}
          placeholder="Title, link or workspace"
          className="border-input bg-field h-10 w-full max-w-[380px] rounded-sm border-[1.5px] px-3 text-sm"
        />
        <label htmlFor="form-state" className="sr-only">
          State
        </label>
        <select
          id="form-state"
          name="state"
          defaultValue={st ?? ""}
          className="border-input bg-field h-10 rounded-sm border-[1.5px] px-2 text-sm"
        >
          <option value="">Any state</option>
          <option value="live">Live</option>
          <option value="draft">Draft</option>
          <option value="closed">Closed</option>
        </select>
        <button
          type="submit"
          className="fc-focus border-ink rounded-sm border-[1.5px] px-4 text-sm font-semibold"
        >
          Filter
        </button>
      </form>
      <div className="border-border overflow-x-auto rounded-lg border-[1.5px]">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Form</th>
              <th className="px-3 py-2">Workspace</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Responses</th>
              <th className="px-3 py-2">Last response</th>
              <th className="px-3 py-2">Changed</th>
            </tr>
          </thead>
          <tbody>
            {forms.map((f) => (
              <tr key={f.id} className="border-border border-t">
                <td className="px-3 py-2">
                  {f.title}
                  <div className="text-muted-foreground text-xs">/f/{f.slug}</div>
                </td>
                <td className="px-3 py-2">
                  <Link className="underline" href={`/admin/customers/${f.workspace_id}`}>
                    {f.workspace_name}
                  </Link>
                  {f.workspace_status !== "active" && (
                    <span className="text-muted-foreground"> ({f.workspace_status})</span>
                  )}
                </td>
                <td className="px-3 py-2">{f.state}</td>
                <td className="px-3 py-2">{f.responses}</td>
                <td className="px-3 py-2">
                  {f.last_response_at ? (
                    <LocalTime iso={f.last_response_at} variant="day" />
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  <LocalTime iso={f.updated_at} variant="day" />
                </td>
              </tr>
            ))}
            {forms.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-3 py-4">
                  No forms match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {forms.length === 50 && (
        <Link
          className="self-start text-sm underline"
          href={qs({ page: String(offset / 50 + 1) })}
        >
          Next 50
        </Link>
      )}
    </main>
  );
}
