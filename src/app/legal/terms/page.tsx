import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { LEGAL } from "@/domains/marketing/legal";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The terms for using FormCraft: accounts, plans, acceptable use and liability.",
};

const mail = (
  <a className="underline" href={`mailto:${LEGAL.contactEmail}`}>
    {LEGAL.contactEmail}
  </a>
);

const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "The agreement",
    body: (
      <p>
        These terms are an agreement between you and {LEGAL.operator} for the use of
        FormCraft at {LEGAL.site}. By creating an account or using the service you accept
        them. If you use FormCraft for an organisation, you confirm you may accept them on
        its behalf, and &quot;you&quot; includes it. Our{" "}
        <Link className="underline" href="/legal/privacy">
          privacy policy
        </Link>{" "}
        explains how we handle personal data.
      </p>
    ),
  },
  {
    id: "accounts",
    title: "Accounts",
    body: (
      <ul>
        <li>You must be 18 or over and give accurate details.</li>
        <li>
          Keep your password and two-factor codes safe; you&apos;re responsible for what
          happens in your account and workspaces.
        </li>
        <li>
          Workspace owners and admins decide who joins, their roles, and what happens to
          the workspace&apos;s data.
        </li>
      </ul>
    ),
  },
  {
    id: "plans",
    title: "Plans, billing and cancellation",
    body: (
      <>
        <ul>
          <li>
            Free costs nothing. Paid plans (Starter, Pro, Business) are billed monthly or
            yearly in advance, at the prices on our{" "}
            <Link className="underline" href="/pricing">
              pricing page
            </Link>
            , by card through Stripe or by UPI or card through Razorpay.
          </li>
          <li>Subscriptions renew automatically until cancelled.</li>
          <li>
            Cancelling takes effect at the end of the period you&apos;ve paid for; the
            workspace then moves to Free and keeps its forms and responses, within
            Free&apos;s limits.
          </li>
          <li>
            Payments aren&apos;t refunded for a part-used period, except where the law
            requires.
          </li>
          <li>
            Prices exclude taxes, which are added where they apply. If a renewal payment
            fails, features of the paid plan may stop until it&apos;s paid.
          </li>
          <li>
            We may change prices for future periods with at least 30 days&apos; notice;
            you can cancel before the change applies.
          </li>
        </ul>
        <p>
          Each plan has monthly allowances (emails, AI credits, storage, API requests and
          others). Responses are never refused; above a plan&apos;s fair-use level we may
          get in touch about a plan that fits. When another allowance runs out, the
          feature pauses as the pricing page describes until the next month or an upgrade.
        </p>
      </>
    ),
  },
  {
    id: "content",
    title: "Your content and your respondents",
    body: (
      <>
        <p>
          You own the forms you build and the responses you collect. You give us
          permission to host, copy, process and display them only as needed to run the
          service for you.
        </p>
        <p>As the person collecting the answers, you are responsible for:</p>
        <ul>
          <li>
            Telling respondents who you are, what you collect and why, and getting any
            consent the law requires.
          </li>
          <li>
            Having a lawful basis for the data you ask for, and handling requests from
            respondents about their answers.
          </li>
          <li>
            Not asking for card numbers, passwords or government ID numbers in form
            fields; use the payment step for payments.
          </li>
          <li>
            The emails, integrations and pixels you turn on, and what they send to others.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>Don&apos;t use FormCraft to:</p>
        <ul>
          <li>
            Impersonate a person, company or service, or collect passwords or payment
            details under false pretences (phishing).
          </li>
          <li>
            Break the law, infringe others&apos; rights, or collect data you have no right
            to.
          </li>
          <li>Send spam, or harass, threaten or exploit anyone, including children.</li>
          <li>
            Spread malware, or attack, probe or overload the service or other users.
          </li>
          <li>
            Get around plan limits, rate limits or security controls, or resell the
            service without our agreement.
          </li>
        </ul>
        <p>
          We may remove content, suspend a form or workspace, or close an account that
          breaks these rules, and report illegal activity. Where we can, we&apos;ll tell
          you first and give you a chance to fix it.
        </p>
      </>
    ),
  },
  {
    id: "third-party",
    title: "Other services",
    body: (
      <p>
        Integrations (such as Google, HubSpot, Stripe, Razorpay, Slack and Airtable) are
        provided by other companies under their own terms. We aren&apos;t responsible for
        them, and a connection may stop working if they change or end their service.
      </p>
    ),
  },
  {
    id: "service",
    title: "The service",
    body: (
      <p>
        We work to keep FormCraft available and your data safe, but the service is
        provided &quot;as is&quot; and &quot;as available&quot;. We may improve, change or
        retire features, and we&apos;ll give reasonable notice before removing anything
        significant from a paid plan. Beta and AI features may make mistakes; check their
        output before you rely on it.
      </p>
    ),
  },
  {
    id: "termination",
    title: "Ending the agreement",
    body: (
      <>
        <p>
          You can delete your account at any time in Settings. We may end or suspend the
          service to you for a serious or repeated breach of these terms, for unpaid fees,
          or where the law requires.
        </p>
        <p>
          Before closing a workspace, export what you want to keep (CSV, Excel, PDF or the
          API). After an account or form is deleted, its data is removed from the service,
          with deleted forms purged after 30 days and backups expiring on our host&apos;s
          schedule.
        </p>
      </>
    ),
  },
  {
    id: "ip",
    title: "Our intellectual property",
    body: (
      <p>
        FormCraft&apos;s software, design and brand belong to {LEGAL.operator}. You may
        use them only to use the service. Feedback you give us may be used to improve
        FormCraft, without any obligation to you.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Liability",
    body: (
      <>
        <p>
          To the extent the law allows, {LEGAL.operator} isn&apos;t liable for indirect or
          consequential losses, lost profits, revenue or data, and our total liability for
          any claim is limited to the fees you paid us in the 12 months before it arose
          (or ₹5,000 if you&apos;ve paid nothing). Nothing here limits liability that
          can&apos;t be limited by law.
        </p>
        <p>
          You agree to cover our reasonable costs from claims caused by your content, your
          forms or your breach of these terms.
        </p>
      </>
    ),
  },
  {
    id: "law",
    title: "Law and disputes",
    body: (
      <p>
        These terms are governed by {LEGAL.governingLaw}. Any dispute goes to{" "}
        {LEGAL.courts}, which have exclusive jurisdiction, unless the law where you live
        gives you the right to bring it there. Please write to {mail} first; most problems
        are solved faster that way.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        We&apos;ll post changes here with a new date and tell account owners at least 30
        days before a significant change takes effect. Using FormCraft after that means
        you accept the new terms; if you don&apos;t, you can cancel and delete your
        account.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        {LEGAL.operator}: {mail}.
      </p>
    ),
  },
];

/** The terms of service (decided 28 Nov 2026; facts in legal.ts). */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      intro={
        <p>
          The rules for using FormCraft: your account, paying for a plan, what you may and
          may not do, and what each of us is responsible for.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
