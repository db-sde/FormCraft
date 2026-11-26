import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/app-shell/brand";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SOC2_LONG, SOC2_SHORT } from "@/domains/marketing/claims";

export const metadata: Metadata = {
  title: "Security",
  description: `How FormCraft protects your forms and responses. ${SOC2_SHORT}.`,
};

const CONTROLS: [string, string][] = [
  [
    "Workspace isolation",
    "Row-level security on every table holding your data, and every server action checks your membership and role again.",
  ],
  [
    "Sign-in",
    "Passwords, optional two-factor codes with recovery codes, and SAML single sign-on that a workspace can require (Business).",
  ],
  [
    "Roles and permissions",
    "Owner, admin, editor and viewer, with per-member permissions for responses, exports, publishing and integrations.",
  ],
  [
    "Audit log",
    "Publishing, members, roles, keys, exports, retention, two-factor, single sign-on and privacy requests are recorded by the server (Business).",
  ],
  [
    "Encryption",
    "TLS in transit; encryption at rest by the database host; integration credentials additionally encrypted by FormCraft (AES-256-GCM).",
  ],
  [
    "Secrets shown once",
    "API keys, SCIM tokens, resume links, invitations and recovery codes are stored only as hashes.",
  ],
  [
    "Retention and erasure",
    "Retention per workspace and per form, purging of deleted forms after 30 days, and privacy requests that find, export and delete one person's responses.",
  ],
  ["Payments", "Card details never reach FormCraft: payments run on Stripe or Razorpay."],
  [
    "Abuse protection",
    "Rate limits on public endpoints, spam traps, idempotent submissions, signed webhooks and checks on outbound URLs.",
  ],
];

const FAQ: [string, string][] = [
  ["Is FormCraft SOC 2 audited?", SOC2_LONG],
  [
    "Can you send us a SOC 2 report?",
    "No. FormCraft has no SOC 2 report of its own to share, and our providers' reports cover their infrastructure, not FormCraft's controls. This page and our subprocessor list describe what FormCraft does.",
  ],
  [
    "Where is my data stored?",
    "In FormCraft's Supabase database and file storage in Sydney, Australia (ap-southeast-2). The app runs on Vercel in the same region.",
  ],
  [
    "Do respondents' browsers contact Google for fonts?",
    "No. Library fonts are served from FormCraft's own domain.",
  ],
  [
    "What doesn't FormCraft offer yet?",
    "Customer-managed encryption keys, field-level encryption of answers, data-residency choices and built-in consent management.",
  ],
];

/** The security page (developer spec item 6: compliance section and FAQ,
 * approved wording only). */
export default function SecurityPage() {
  return (
    <div className="bg-background flex-1">
      <header className="mx-auto box-content flex max-w-[1200px] items-center gap-4 px-[clamp(16px,4vw,40px)] py-[18px]">
        <Brand />
      </header>
      <main className="mx-auto box-content flex max-w-[860px] flex-col gap-10 px-[clamp(16px,4vw,40px)] pt-6 pb-16">
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-[clamp(36px,5vw,52px)] leading-none font-bold tracking-[-0.035em]">
            Security
          </h1>
          <p className="text-muted-foreground text-[17px]">
            What FormCraft does to keep forms, responses and files safe, and what it
            doesn&apos;t claim.
          </p>
        </div>

        <section aria-labelledby="compliance" className="flex flex-col gap-3">
          <h2 id="compliance" className="font-heading text-2xl font-bold">
            Compliance
          </h2>
          <p className="border-ink bg-card rounded-xl border-[1.5px] p-4 font-semibold">
            {SOC2_SHORT}
          </p>
          <p>{SOC2_LONG}</p>
          <p className="text-muted-foreground text-sm">
            FormCraft is not HIPAA compliant and holds no ISO 27001 or PCI DSS attestation
            of its own. See the{" "}
            <Link className="underline" href="/legal/subprocessors">
              subprocessors
            </Link>{" "}
            that handle data on FormCraft&apos;s behalf.
          </p>
        </section>

        <section aria-labelledby="controls" className="flex flex-col gap-3">
          <h2 id="controls" className="font-heading text-2xl font-bold">
            FormCraft&apos;s own controls
          </h2>
          <dl className="divide-border border-ink divide-y rounded-xl border-[1.5px]">
            {CONTROLS.map(([term, text]) => (
              <div key={term} className="grid gap-1 px-4 py-3 sm:grid-cols-[200px_1fr]">
                <dt className="font-semibold">{term}</dt>
                <dd className="text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="faq" className="flex flex-col gap-3">
          <h2 id="faq" className="font-heading text-2xl font-bold">
            Questions
          </h2>
          {FAQ.map(([q, a]) => (
            <details key={q} className="border-ink rounded-xl border-[1.5px] px-4 py-3">
              <summary className="cursor-pointer font-semibold">{q}</summary>
              <p className="text-muted-foreground mt-2">{a}</p>
            </details>
          ))}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
