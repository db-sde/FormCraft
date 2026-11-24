import type { Metadata } from "next";
import Link from "next/link";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { LocalTime } from "@/components/local-time";

export const metadata: Metadata = { title: "Customers" };

type Customer = {
  id: string;
  name: string;
  slug: string;
  plan_id: string;
  status: string;
  created_at: string;
  owner_email: string | null;
  members: number;
  forms: number;
};

/** The customer directory (ADM-008): search by workspace name or slug, a
 * member's email, or a custom domain. Each search is recorded. */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireStaff("customers.read");
  const { q = "", page = "0" } = await searchParams;
  const query = q.trim().slice(0, 120);
  const offset = Math.max(0, Number.parseInt(page, 10) || 0) * 50;
  const result =
    query.length >= 2
      ? await adminCall<{ customers: Customer[] }>("admin_search_customers", {
          p_query: query,
          p_limit: 50,
          p_offset: offset,
        })
      : null;
  const customers = result?.ok ? result.customers : [];
  return (
    <main className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">Customers</h1>
      <form className="flex gap-2" action="/admin/customers">
        <label htmlFor="customer-search" className="sr-only">
          Search customers
        </label>
        <input
          id="customer-search"
          name="q"
          defaultValue={query}
          minLength={2}
          maxLength={120}
          placeholder="Workspace name, slug, member email or domain"
          className="border-input bg-field h-10 w-full max-w-[480px] rounded-sm border-[1.5px] px-3 text-sm"
        />
        <button
          type="submit"
          className="fc-focus border-ink rounded-sm border-[1.5px] px-4 text-sm font-semibold"
        >
          Search
        </button>
      </form>
      {query.length >= 2 && (
        <div className="border-border overflow-x-auto rounded-lg border-[1.5px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Workspace</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Members</th>
                <th className="px-3 py-2">Forms</th>
                <th className="px-3 py-2">Since</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-border border-t">
                  <td className="px-3 py-2">
                    <Link
                      className="font-semibold underline"
                      href={`/admin/customers/${c.id}`}
                    >
                      {c.name}
                    </Link>
                    <div className="text-muted-foreground text-xs">{c.slug}</div>
                  </td>
                  <td className="px-3 py-2">{c.owner_email ?? "—"}</td>
                  <td className="px-3 py-2">{c.plan_id}</td>
                  <td className="px-3 py-2">{c.status}</td>
                  <td className="px-3 py-2">{c.members}</td>
                  <td className="px-3 py-2">{c.forms}</td>
                  <td className="px-3 py-2">
                    <LocalTime iso={c.created_at} variant="date" />
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted-foreground px-3 py-4">
                    No workspace matches “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {customers.length === 50 && (
        <Link
          className="self-start text-sm underline"
          href={`/admin/customers?q=${encodeURIComponent(query)}&page=${offset / 50 + 1}`}
        >
          Next 50
        </Link>
      )}
    </main>
  );
}
