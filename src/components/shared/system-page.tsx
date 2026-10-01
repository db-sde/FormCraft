import { Brand } from "@/components/app-shell/brand";

/** 404 / error pages (Part 7 §7): FormCraft-branded, two tilted cards
 * with a glyph on the left, a big title and plain copy on the right. */
export function SystemPage({
  glyph,
  title,
  body,
  actions,
  code,
}: {
  glyph: string;
  title: string;
  body: React.ReactNode;
  actions: React.ReactNode;
  code?: React.ReactNode;
}) {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="px-7 py-5">
        <Brand href="/" size="sm" />
      </header>
      <main className="flex flex-1 flex-col items-start gap-8 px-6 pb-10 sm:flex-row sm:items-center sm:justify-center sm:gap-10 sm:px-14">
        <div aria-hidden className="relative size-[150px] shrink-0 sm:size-[180px]">
          <div className="border-ink bg-card absolute inset-[10px_20px_30px_0] -rotate-8 rounded-xl border-[1.5px]" />
          <div className="border-ink bg-primary font-heading shadow-lift absolute inset-[30px_0_10px_30px] grid rotate-6 place-items-center rounded-xl border-[1.5px] text-5xl leading-none font-bold text-[#2b2118]">
            {glyph}
          </div>
        </div>
        <div className="flex max-w-[420px] flex-col gap-3.5">
          <h1 className="font-heading text-[36px] leading-none font-bold tracking-[-0.035em] sm:text-[44px]">
            {title}
          </h1>
          <p className="text-muted-foreground text-base leading-[1.55]">{body}</p>
          <div className="mt-1.5 flex flex-wrap gap-2.5">{actions}</div>
          {code && (
            <span className="text-muted-foreground font-mono text-xs">{code}</span>
          )}
        </div>
      </main>
    </div>
  );
}
