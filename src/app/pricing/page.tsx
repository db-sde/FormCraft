import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Brand, LogoMark } from "@/components/app-shell/brand";
import {
  featureName,
  resolveEntitlements,
  type Entitlements,
} from "@/domains/billing/entitlements";
import { FEATURE_GROUPS } from "@/domains/billing/catalog";
import { cn } from "cn";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free forever for unlimited forms and responses. Starter, Pro and Business add branding, teamwork and control, with 0% FormCraft fee on payments.",
};

type Plan = {
  id: string;
  name: string;
  monthly: number;
  annual: number;
  tagline: string;
  e: Entitlements;
};

const n = (v: number | null, unit = "") =>
  v === null ? "Unlimited" : `${v.toLocaleString()}${unit}`;
const gb = (mb: number | null) => (mb === null ? "Unlimited" : `${mb / 1000} GB`);

/** The rows of the comparison: limits first, then features by group. */
const LIMIT_ROWS: { label: string; value: (e: Entitlements) => string }[] = [
  { label: "Forms", value: () => "Unlimited" },
  {
    label: "Responses (fair use)",
    value: (e) =>
      e.responses_per_month === null
        ? "Unlimited"
        : `Unlimited; reviewed above ${e.responses_per_month.toLocaleString()}/mo`,
  },
  { label: "Seats", value: (e) => n(e.members) },
  { label: "File storage", value: (e) => gb(e.storage_mb) },
  {
    label: "Custom domains",
    value: (e) => (e.custom_domains === 0 ? "—" : n(e.custom_domains)),
  },
  {
    label: "AI credits / month",
    value: (e) => (e.ai_credits_per_month === 0 ? "—" : n(e.ai_credits_per_month)),
  },
  { label: "Notification emails / month", value: (e) => n(e.emails_per_month) },
  {
    label: "Address suggestions / month",
    value: (e) =>
      e.address_lookups_per_month === 0 ? "—" : n(e.address_lookups_per_month),
  },
  {
    label: "Video and audio answers",
    value: (e) =>
      e.recording_seconds === null
        ? "Any length"
        : `${Math.round(e.recording_seconds / 60)} min`,
  },
  {
    label: "Booking types",
    value: (e) => n(e.booking_types),
  },
  {
    label: "API",
    value: (e) =>
      `${n(e.api_requests_per_minute)}/min · ${e.api_requests_per_day === null ? "no daily cap" : `${e.api_requests_per_day.toLocaleString()}/day`} · ${e.api_keys === null ? "unlimited" : e.api_keys} keys`,
  },
  { label: "FormCraft fee on payments", value: () => "0%" },
];

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const monthly = (await searchParams).billing === "monthly";
  const supabase = await createServerSupabaseClient();
  const [{ data: rows }, { data: auth }] = await Promise.all([
    supabase.rpc("public_plans"),
    supabase.auth.getUser(),
  ]);
  const signedIn = Boolean(auth.user);
  const plans: Plan[] = (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    monthly: Number(r.monthly_usd ?? 0),
    annual: Number(r.annual_usd ?? 0),
    tagline: r.tagline ?? "",
    e: resolveEntitlements(r.entitlements, null),
  }));

  const toggle = (label: string, active: boolean, href: string) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "fc-focus rounded-sm px-3 py-1.5 text-sm font-semibold",
        active ? "bg-ink text-background" : "hover:underline",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="bg-background flex-1">
      <header className="mx-auto box-content flex max-w-[1200px] items-center gap-4 px-[clamp(16px,4vw,40px)] py-[18px]">
        <Brand />
        <div className="flex-1" />
        <Link
          href={signedIn ? "/dashboard" : "/signup"}
          className="fc-focus border-ink bg-primary text-primary-foreground shadow-raised flex h-10 items-center rounded-sm border-[1.5px] px-4 text-[14.5px] font-bold whitespace-nowrap"
        >
          {signedIn ? "Go to dashboard" : "Sign up free"}
        </Link>
      </header>

      <main className="mx-auto box-content flex max-w-[1200px] flex-col gap-8 px-[clamp(16px,4vw,40px)] pt-6 pb-16">
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-[clamp(36px,5vw,56px)] leading-none font-bold tracking-[-0.035em]">
            Pricing
          </h1>
          <p className="text-muted-foreground max-w-[640px] text-[17px]">
            Unlimited forms and responses on every plan, including Free. Pay for branding,
            teamwork and control, never for the number of submissions.
          </p>
          <div
            className="border-ink flex self-start rounded-sm border-[1.5px] p-1"
            role="group"
            aria-label="Billing period"
          >
            {toggle("Yearly", !monthly, "/pricing")}
            {toggle("Monthly", monthly, "/pricing?billing=monthly")}
          </div>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Plans">
          {plans.map((p) => {
            const price = monthly ? p.monthly : p.annual;
            const highlight = p.id === "pro";
            return (
              <article
                key={p.id}
                className={cn(
                  "border-ink bg-card flex flex-col gap-3 rounded-xl border-[1.5px] p-5",
                  highlight && "shadow-lift",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-heading text-xl font-bold">{p.name}</h2>
                  {highlight && (
                    <span className="bg-primary rounded-full px-2 py-0.5 text-xs font-bold">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground text-sm">{p.tagline}</p>
                <p>
                  <span className="font-heading text-4xl font-bold">${price}</span>
                  <span className="text-muted-foreground text-sm">
                    {price === 0
                      ? " forever"
                      : monthly
                        ? " / month"
                        : " / month, billed yearly"}
                  </span>
                </p>
                <ul className="flex flex-col gap-1.5 text-sm">
                  <li>
                    {n(p.e.members)} {p.e.members === 1 ? "seat" : "seats"}
                  </li>
                  <li>{gb(p.e.storage_mb)} file storage</li>
                  <li>{n(p.e.emails_per_month)} notification emails / month</li>
                  {p.e.ai_credits_per_month !== 0 && (
                    <li>{n(p.e.ai_credits_per_month)} AI credits / month</li>
                  )}
                  {p.e.custom_domains !== 0 && (
                    <li>
                      {n(p.e.custom_domains)} custom domain
                      {p.e.custom_domains === 1 ? "" : "s"}
                    </li>
                  )}
                </ul>
                <Link
                  href={signedIn ? "/settings?tab=plan" : "/signup"}
                  className={cn(
                    "fc-focus border-ink mt-auto flex h-10 items-center justify-center rounded-sm border-[1.5px] px-4 text-sm font-bold",
                    highlight ? "bg-primary" : "bg-background",
                  )}
                >
                  {p.id === "free"
                    ? "Start free"
                    : signedIn
                      ? `Choose ${p.name}`
                      : `Start with ${p.name}`}
                </Link>
              </article>
            );
          })}
        </section>
        <p className="text-muted-foreground text-sm">
          Paid plans: sign up free, then ask for the plan in Settings → Plan and
          we&apos;ll set up billing with you. Prices in US dollars; GST is added for
          customers in India.
        </p>

        <section aria-labelledby="compare" className="flex flex-col gap-3">
          <h2 id="compare" className="font-heading text-2xl font-bold">
            Compare plans
          </h2>
          <div className="border-ink overflow-x-auto rounded-xl border-[1.5px]">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-card">
                <tr>
                  <th className="px-3 py-2.5">
                    <span className="sr-only">Feature</span>
                  </th>
                  {plans.map((p) => (
                    <th key={p.id} className="font-heading px-3 py-2.5">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIMIT_ROWS.map((row) => (
                  <tr key={row.label} className="border-border border-t">
                    <th scope="row" className="px-3 py-2 font-normal">
                      {row.label}
                    </th>
                    {plans.map((p) => (
                      <td key={p.id} className="px-3 py-2">
                        {row.value(p.e)}
                      </td>
                    ))}
                  </tr>
                ))}
                {FEATURE_GROUPS.map((group) => (
                  <FeatureGroupRows key={group.title} group={group} plans={plans} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-sm">
            Every plan includes all 29 question types, logic and quizzes, themes, payments
            through your own Stripe or Razorpay account, webhooks, Google Sheets,
            two-factor sign-in, privacy requests and account deletion. Hosted on SOC 2
            audited infrastructure (Vercel, Supabase). Some features need their provider
            set up first, such as Google sign-in for Sheets.
          </p>
          <p className="text-muted-foreground text-sm">
            When a monthly allowance runs out, nothing is lost: notification emails switch
            to one summary a day, address fields fall back to typing, and AI pauses until
            the 1st. Responses above the fair-use level are always saved and delivered; we
            may get in touch about a plan that fits.
          </p>
        </section>
      </main>

      <footer className="text-muted-foreground mx-auto box-content flex max-w-[1200px] flex-wrap items-center gap-x-7 gap-y-4 px-[clamp(16px,4vw,40px)] py-7 text-[13.5px]">
        <span className="text-foreground flex items-center gap-2 font-bold">
          <LogoMark size={14} />
          FormCraft
        </span>
        <span>© 2026 FormCraft</span>
        <div className="flex-1" />
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <Link href="/templates" className="hover:underline">
          Templates
        </Link>
      </footer>
    </div>
  );
}

function FeatureGroupRows({
  group,
  plans,
}: {
  group: (typeof FEATURE_GROUPS)[number];
  plans: Plan[];
}) {
  return (
    <>
      <tr className="border-border bg-card/60 border-t">
        <th
          colSpan={plans.length + 1}
          scope="colgroup"
          className="px-3 py-2 font-semibold"
        >
          {group.title}
        </th>
      </tr>
      {group.features.map((f) => (
        <tr key={f} className="border-border border-t">
          <th scope="row" className="px-3 py-2 font-normal">
            {featureName(f)}
          </th>
          {plans.map((p) => (
            <td key={p.id} className="px-3 py-2">
              {p.e[f] ? (
                <Check
                  className="size-4 text-[var(--chip-live-dot)]"
                  aria-label="Included"
                />
              ) : (
                <Minus
                  className="text-muted-foreground size-4"
                  aria-label="Not included"
                />
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
