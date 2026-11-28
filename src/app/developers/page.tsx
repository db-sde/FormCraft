import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/app-shell/brand";
import { SiteFooter } from "@/components/marketing/site-footer";
import { ApiLimitsTable } from "@/components/marketing/api-limits-table";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "The FormCraft REST API: on every plan, with published rate limits. Works with Zapier, Make and n8n.",
};

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/api/v1/me", "The key's workspace and permissions"],
  [
    "GET",
    "/api/v1/forms?archived=false|true|all",
    "Forms, each marked published or not (or archived ones)",
  ],
  ["GET", "/api/v1/forms/{id}", "A form and its live questions"],
  ["POST", "/api/v1/forms/{id}/archive", "Archive a form (forms:write)"],
  ["POST", "/api/v1/forms/{id}/restore", "Restore an archived form (forms:write)"],
  ["GET", "/api/v1/forms/{id}/responses", "A form's completed responses"],
  ["GET", "/api/v1/responses/{id}", "One response"],
  ["POST", "/api/v1/hooks", "Subscribe a URL to new responses"],
  ["DELETE", "/api/v1/hooks/{id}", "Remove a subscription"],
];

/** The developer page (developer spec item 5): the API on every plan and
 * its published limits. */
export default function DevelopersPage() {
  return (
    <div className="bg-background flex-1">
      <header className="mx-auto box-content flex max-w-[1200px] items-center gap-4 px-[clamp(16px,4vw,40px)] py-[18px]">
        <Brand />
      </header>
      <main className="mx-auto box-content flex max-w-[900px] flex-col gap-10 px-[clamp(16px,4vw,40px)] pt-6 pb-16">
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-[clamp(36px,5vw,52px)] leading-none font-bold tracking-[-0.035em]">
            Developers
          </h1>
          <p className="text-muted-foreground text-[17px]">
            The FormCraft REST API is on every plan, Free included, so Zapier, Make and
            n8n work everywhere. Create a key in Settings → API; it&apos;s shown once and
            stored hashed.
          </p>
        </div>

        <section aria-labelledby="auth" className="flex flex-col gap-3">
          <h2 id="auth" className="font-heading text-2xl font-bold">
            Authentication
          </h2>
          <pre className="border-ink bg-card overflow-x-auto rounded-xl border-[1.5px] p-4 text-sm">
            {
              'curl https://form-craft-ivory.vercel.app/api/v1/forms \\\n  -H "Authorization: Bearer fc_live_…"'
            }
          </pre>
          <p className="text-muted-foreground text-sm">
            A key belongs to one workspace and has the permissions chosen when it was
            made: forms:read, forms:write, responses:read and hooks:write.
          </p>
        </section>

        <section aria-labelledby="endpoints" className="flex flex-col gap-3">
          <h2 id="endpoints" className="font-heading text-2xl font-bold">
            Endpoints
          </h2>
          <ul className="border-ink divide-border divide-y rounded-xl border-[1.5px] text-sm">
            {ENDPOINTS.map(([method, path, what]) => (
              <li
                key={`${method} ${path}`}
                className="grid gap-1 px-4 py-2.5 sm:grid-cols-[70px_1fr_1fr]"
              >
                <b className="font-mono text-xs">{method}</b>
                <code className="text-xs break-all">{path}</code>
                <span className="text-muted-foreground">{what}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="limits" className="flex flex-col gap-3">
          <h2 id="limits" className="font-heading text-2xl font-bold">
            Rate limits
          </h2>
          <p>
            Limits are per workspace, across all its keys: a bucket that refills at the
            per-minute rate and holds up to the burst, plus a daily count that resets at
            00:00 UTC.
          </p>
          <ApiLimitsTable />
          <p className="text-muted-foreground text-sm">
            Every response carries <code>X-RateLimit-Limit</code>,{" "}
            <code>X-RateLimit-Remaining</code>, <code>X-RateLimit-Reset</code> (seconds)
            and <code>X-RateLimit-Daily-Remaining</code>. Over a limit you get HTTP 429
            with a <code>Retry-After</code> header and{" "}
            <code>{'{"error":"rate_limited","scope":"minute|day","retry_after":N}'}</code>
            . Webhooks and integrations FormCraft sends, and form submissions, don&apos;t
            count. Plan features still apply: a setting your plan doesn&apos;t include
            returns <code>403 plan_required</code>, naming the plan needed.
          </p>
        </section>

        <p className="text-sm">
          See{" "}
          <Link className="underline" href="/pricing">
            pricing
          </Link>{" "}
          for what each plan includes.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
