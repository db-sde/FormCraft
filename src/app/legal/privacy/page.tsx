import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { LEGAL } from "@/domains/marketing/legal";
import { SOC2_SHORT } from "@/domains/marketing/claims";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What FormCraft collects, why, who it's shared with, and your choices.",
};

const mail = (
  <a className="underline" href={`mailto:${LEGAL.contactEmail}`}>
    {LEGAL.contactEmail}
  </a>
);

const SECTIONS: LegalSection[] = [
  {
    id: "who",
    title: "Who we are and our role",
    body: (
      <>
        <p>
          {LEGAL.operator} (&quot;we&quot;, &quot;us&quot;) runs the form builder at{" "}
          {LEGAL.site}. Contact us at {mail}.
        </p>
        <ul>
          <li>
            <b>For your account</b> (the people who sign up and build forms), we decide
            how the data is used: we are its controller.
          </li>
          <li>
            <b>For the answers people submit to a form</b>, the creator of that form
            decides what to collect and why. We process those answers on the
            creator&apos;s behalf and only to run the service for them. If you filled in a
            form and want your answers seen, changed or deleted, contact the person or
            organisation that made the form; we will help them do it.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <ul>
        <li>
          <b>Account details:</b> name, email address, password (stored only as a hash by
          our sign-in provider), two-factor settings, the workspaces you belong to and
          your role in them.
        </li>
        <li>
          <b>What you create:</b> forms, themes, templates, settings, files you upload,
          email templates and integration settings.
        </li>
        <li>
          <b>Form responses:</b> the answers, files, signatures and recordings respondents
          submit, unfinished answers where the form keeps them, and the time and page they
          came from.
        </li>
        <li>
          <b>Billing:</b> your plan, subscription status and billing contact. Card and UPI
          details are handled by Stripe or Razorpay and never reach us.
        </li>
        <li>
          <b>Technical data:</b> IP address, browser and device type, request logs and
          error reports, used for security, rate limiting and fixing problems.
        </li>
        <li>
          <b>Product usage:</b> which features are used (events carry ids, never form
          answers), to improve the product.
        </li>
      </ul>
    ),
  },
  {
    id: "use",
    title: "How we use it",
    body: (
      <>
        <ul>
          <li>
            To provide the service: hosting forms, storing responses, sending the emails
            and integrations you set up.
          </li>
          <li>
            To keep it secure: sign-in, two-factor checks, spam and abuse prevention, rate
            limits.
          </li>
          <li>To bill for paid plans and enforce plan limits.</li>
          <li>
            To support you and tell you about changes to the service or these terms.
          </li>
          <li>
            To understand and improve how the product is used, using aggregated usage
            data.
          </li>
        </ul>
        <p>
          We rely on our contract with you, our legitimate interest in running a secure
          service, and your consent where the law requires it. We do not sell personal
          data and we do not use form answers for advertising.
        </p>
      </>
    ),
  },
  {
    id: "ai",
    title: "AI features",
    body: (
      <p>
        AI features run only when a creator uses them. They send the form&apos;s text and,
        for response analysis, written answers to Anthropic, with email addresses, phone
        numbers and files left out. Anthropic does not use this data to train its models
        under its commercial terms. Respondents are never asked questions written by AI
        unless the creator turns on AI follow-up questions for their form.
      </p>
    ),
  },
  {
    id: "google",
    title: "Google user data",
    body: (
      <>
        <p>
          If you connect a Google account, FormCraft asks only for what each feature
          needs:
        </p>
        <ul>
          <li>
            <b>Google Sheets</b> (<code>spreadsheets</code>): to add a row for each
            response to the spreadsheet you choose.
          </li>
          <li>
            <b>Google Drive</b> (<code>drive.file</code>): to copy uploaded files into a
            folder FormCraft creates. FormCraft sees only the files and folders it made.
          </li>
          <li>
            <b>Google Calendar</b> (<code>calendar.events</code>,{" "}
            <code>calendar.freebusy</code>, <code>calendar.calendarlist.readonly</code>):
            to check your free and busy times for bookings and add booked events to the
            calendar you pick.
          </li>
        </ul>
        <p>
          FormCraft&apos;s use and transfer of information received from Google APIs
          adheres to the{" "}
          <a
            className="underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We use Google data only to provide
          these features, never for advertising, never to train AI models, and we
          don&apos;t let people read it except with your permission, for security, or
          where the law requires. Disconnect at any time in FormCraft or in your Google
          account&apos;s security settings; the stored access tokens are then deleted.
        </p>
      </>
    ),
  },
  {
    id: "share",
    title: "Who we share it with",
    body: (
      <>
        <p>
          Providers that run parts of the service for us, under contract, and only for
          that purpose. They&apos;re listed with what they receive on our{" "}
          <Link className="underline" href="/legal/subprocessors">
            subprocessors page
          </Link>
          : Supabase (database and files), Vercel (hosting), Resend (email), Stripe and
          Razorpay (billing), Anthropic (AI), Google (address suggestions, fonts fetched
          by our server), PostHog (product analytics) and Sentry (error reports).
        </p>
        <p>
          Integrations a creator turns on (webhooks, Google Sheets, HubSpot, Slack and
          others) receive what the creator chooses to send them. We also disclose data
          when the law requires it, or to protect people and the service from harm.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and similar technology",
    body: (
      <>
        <p>FormCraft&apos;s own cookies are needed for the service to work:</p>
        <ul>
          <li>
            Sign-in cookies that keep you logged in, and <code>fc_workspace</code>, the
            workspace you last used.
          </li>
          <li>
            On published forms, <code>fc_vid</code> and <code>fc_vsig</code>: a random
            visitor id (kept up to 180 days) used for A/B tests and &quot;ask once&quot;
            questions, and a cookie that ties an unfinished response to the browser that
            started it.
          </li>
          <li>Short-lived cookies that protect sign-ins to connected apps.</li>
        </ul>
        <p>
          We don&apos;t set advertising cookies. A creator can add their own analytics or
          ad pixels to a form; those set their own cookies, and FormCraft can ask
          respondents for consent first and honours Global Privacy Control. Your
          browser&apos;s local storage keeps conveniences such as a form&apos;s draft
          answers and your view settings.
        </p>
      </>
    ),
  },
  {
    id: "where",
    title: "Where data is stored",
    body: (
      <p>
        Our database and files are in Sydney, Australia (Supabase), and the app runs on
        Vercel in the same region. Some providers above process data in the United States
        or India. Where data moves across borders, we rely on our providers&apos;
        contractual safeguards.
      </p>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <ul>
        <li>
          Account data: while your account is open. Deleting your account deletes it.
        </li>
        <li>
          Forms and responses: until the creator deletes them, or as their retention
          settings say. Deleted forms are purged, files included, after 30 days.
        </li>
        <li>Unfinished responses: as long as the form&apos;s settings allow.</li>
        <li>
          Security logs and audit entries: as long as needed to protect the service.
        </li>
        <li>Backups made by our database host expire on its schedule.</li>
      </ul>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        Encryption in transit and at rest, row-level access control that keeps every
        workspace apart, two-factor sign-in, and integration secrets encrypted again by
        FormCraft. {SOC2_SHORT}; FormCraft has not completed its own SOC 2 audit. Details
        are on our{" "}
        <Link className="underline" href="/security">
          security page
        </Link>
        . We will tell affected users and the authorities about a breach as the law
        requires.
      </p>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>
          Depending on where you live (including under India&apos;s Digital Personal Data
          Protection Act, 2023 and the EU and UK GDPR), you can ask to see, correct,
          export or delete your personal data, withdraw consent, object to some uses, and
          name someone to act for you. Write to {mail}; we answer within 30 days. You can
          also complain to your data protection authority.
        </p>
        <p>
          Respondents: ask the form&apos;s creator first. Creators can find, export and
          erase one person&apos;s responses in Settings → Security → Privacy requests.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        FormCraft accounts are for people 18 and over. A creator who collects answers from
        children is responsible for getting the consent the law requires.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We&apos;ll post changes here with a new date, and tell account owners by email or
        in the app before a significant change takes effect.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        {LEGAL.operator}: {mail}. Grievances under India&apos;s data protection law go to
        the same address.
      </p>
    ),
  },
];

/** The privacy policy (decided 28 Nov 2026; facts in legal.ts). Linked from
 * the footer and the sign-up page, and from Google's consent screen. */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={
        <p>
          This policy explains what personal data FormCraft handles, why, who receives it
          and the choices you have. It covers people who use FormCraft to build forms and,
          where noted, people who fill them in.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
