import type { Metadata } from "next";
import { Brand } from "@/components/app-shell/brand";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SOC2_SHORT } from "@/domains/marketing/claims";

export const metadata: Metadata = {
  title: "Subprocessors",
  description: "The providers that process data on FormCraft's behalf.",
};

const SUBPROCESSORS: { name: string; purpose: string; data: string; where: string }[] = [
  {
    name: "Supabase",
    purpose: "Database, sign-in and file storage",
    data: "Accounts, forms, responses and uploaded files",
    where: "Australia (Sydney)",
  },
  {
    name: "Vercel",
    purpose: "Hosting the app and delivering pages",
    data: "Requests in transit and request logs",
    where: "Australia (Sydney), with a global edge network",
  },
  {
    name: "Resend",
    purpose: "Sending email",
    data: "Recipient addresses and email content",
    where: "United States",
  },
  {
    name: "Stripe",
    purpose: "FormCraft plan billing; payments on forms (creator's own account)",
    data: "Billing contact, plan and payment details",
    where: "United States",
  },
  {
    name: "Razorpay",
    purpose: "FormCraft plan billing in India; payments on forms (creator's own account)",
    data: "Billing contact, plan and payment details",
    where: "India",
  },
  {
    name: "Anthropic",
    purpose: "AI features, when a creator uses them",
    data: "Form text and, for response analysis, written answers (minimised)",
    where: "United States",
  },
  {
    name: "Google",
    purpose:
      "Address suggestions (when a form uses them); font files, fetched by FormCraft's server",
    data: "Address text typed by respondents; no personal data for fonts",
    where: "United States",
  },
  {
    name: "PostHog",
    purpose: "Product analytics",
    data: "Product events with ids, never answers",
    where: "United States",
  },
  {
    name: "Sentry",
    purpose: "Error reports",
    data: "Technical details of errors",
    where: "United States",
  },
];

/** The subprocessor list (developer spec item 6). Integrations a creator
 * turns on (Sheets, HubSpot, Slack…) receive what the creator sends them
 * and are the creator's own choice, so they aren't listed here. */
export default function SubprocessorsPage() {
  return (
    <div className="bg-background flex-1">
      <header className="mx-auto box-content flex max-w-[1200px] items-center gap-4 px-[clamp(16px,4vw,40px)] py-[18px]">
        <Brand />
      </header>
      <main className="mx-auto box-content flex max-w-[1000px] flex-col gap-6 px-[clamp(16px,4vw,40px)] pt-6 pb-16">
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-[clamp(36px,5vw,52px)] leading-none font-bold tracking-[-0.035em]">
            Subprocessors
          </h1>
          <p className="text-muted-foreground text-[17px]">
            The providers that process data on FormCraft&apos;s behalf. {SOC2_SHORT}.
          </p>
        </div>
        <div className="border-ink overflow-x-auto rounded-xl border-[1.5px]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-card">
              <tr>
                <th className="px-3 py-2.5">Provider</th>
                <th className="px-3 py-2.5">What for</th>
                <th className="px-3 py-2.5">Data</th>
                <th className="px-3 py-2.5">Location</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="border-border border-t align-top">
                  <th scope="row" className="px-3 py-2.5 font-semibold">
                    {s.name}
                  </th>
                  <td className="px-3 py-2.5">{s.purpose}</td>
                  <td className="text-muted-foreground px-3 py-2.5">{s.data}</td>
                  <td className="text-muted-foreground px-3 py-2.5">{s.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-sm">
          Integrations a creator turns on for a form (such as Google Sheets, HubSpot,
          Slack or a webhook) receive what the creator chooses to send them.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
