import Link from "next/link";
import { Brand } from "@/components/app-shell/brand";
import { SiteFooter } from "@/components/marketing/site-footer";
import { LEGAL } from "@/domains/marketing/legal";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

/** The shared layout of the privacy policy and the terms: a contents
 * list, then numbered sections. */
export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: React.ReactNode;
  sections: LegalSection[];
}) {
  return (
    <div className="bg-background flex-1">
      <header className="mx-auto box-content flex max-w-[1200px] items-center gap-4 px-[clamp(16px,4vw,40px)] py-[18px]">
        <Brand />
      </header>
      <main className="mx-auto box-content flex max-w-[780px] flex-col gap-8 px-[clamp(16px,4vw,40px)] pt-6 pb-16">
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-[clamp(34px,5vw,48px)] leading-none font-bold tracking-[-0.035em]">
            {title}
          </h1>
          <p className="text-muted-foreground text-sm">Last updated {LEGAL.updated}</p>
          <div className="text-[16px] leading-relaxed">{intro}</div>
        </div>
        <nav aria-label="Contents" className="border-ink rounded-xl border-[1.5px] p-4">
          <h2 className="mb-2 text-sm font-semibold">Contents</h2>
          <ol className="grid list-decimal gap-1 pl-5 text-sm sm:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a className="underline-offset-2 hover:underline" href={`#${s.id}`}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {sections.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            aria-labelledby={`${s.id}-h`}
            className="flex scroll-mt-6 flex-col gap-3"
          >
            <h2 id={`${s.id}-h`} className="font-heading text-xl font-bold">
              {i + 1}. {s.title}
            </h2>
            <div className="flex flex-col gap-3 leading-relaxed [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
              {s.body}
            </div>
          </section>
        ))}
        <p className="text-muted-foreground border-t pt-4 text-sm">
          Questions:{" "}
          <a className="underline" href={`mailto:${LEGAL.contactEmail}`}>
            {LEGAL.contactEmail}
          </a>
          . See also the{" "}
          <Link className="underline" href="/legal/privacy">
            privacy policy
          </Link>
          , the{" "}
          <Link className="underline" href="/legal/terms">
            terms
          </Link>
          , our{" "}
          <Link className="underline" href="/legal/subprocessors">
            subprocessors
          </Link>{" "}
          and{" "}
          <Link className="underline" href="/security">
            security
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
