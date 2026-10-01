import Link from "next/link";
import {
  ArrowRight,
  AtSign,
  Calendar,
  Check,
  CircleDot,
  Gauge,
  Paperclip,
  Plus,
  Sheet,
  Star,
  TextCursorInput,
  ToggleRight,
  Webhook,
} from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Brand, LogoMark } from "@/components/app-shell/brand";

const CHIPS: [string, typeof Star, number][] = [
  ["Short text", TextCursorInput, -3],
  ["Multiple choice", CircleDot, 2],
  ["Rating", Star, -1],
  ["Email", AtSign, 3],
  ["Opinion scale", Gauge, -2],
  ["Yes / No", ToggleRight, 1],
  ["File upload", Paperclip, -3],
  ["Date", Calendar, 2],
  ["+8 more", Plus, 0],
];

const primaryCta =
  "fc-focus inline-flex h-[52px] items-center gap-2 rounded-[8px] border-[1.5px] border-ink bg-primary px-6 text-base font-bold text-[#2b2118] shadow-lift transition-[transform,box-shadow] duration-[80ms] hover:-translate-x-px hover:-translate-y-px hover:shadow-[5px_5px_0_var(--shadow-ink)] active:translate-x-1 active:translate-y-1 active:shadow-none";

/** The two tilted form cards and the "+1 response" toast in the hero. */
function HeroArt() {
  return (
    <div
      aria-hidden
      className="relative h-[clamp(380px,44vw,500px)] max-w-[540px] min-w-0 flex-[1_1_380px]"
    >
      <div
        className="absolute top-[6%] left-[4%] flex h-[70%] w-[62%] -rotate-7 flex-col gap-3 rounded-xl border-[1.5px] border-[#2b2118] bg-[#e4eff4] p-6 text-[#0f2f3b] shadow-[4px_4px_0_#2b2118]"
        style={{ fontFamily: "system-ui, sans-serif" }}
      >
        <span className="text-xs opacity-70">2 →</span>
        <span className="text-[17px] font-semibold">
          How likely are you to recommend us?
        </span>
        <div className="grid grid-cols-6 gap-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className="aspect-square rounded-full border border-[#9fc1cf]"
              style={
                i === 4 ? { background: "#1d6f8c", borderColor: "#1d6f8c" } : undefined
              }
            />
          ))}
        </div>
      </div>
      <div
        className="absolute top-0 right-0 flex w-[66%] rotate-4 flex-col gap-3.5 rounded-xl border-[1.5px] border-[#2b2118] bg-[#ffeee2] p-[26px] text-[#3a1c11] shadow-[6px_6px_0_#2b2118]"
        style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}
      >
        <div className="h-1 rounded-full bg-[#f3c9b6]">
          <div className="h-full w-2/5 rounded-full bg-[#e05d36]" />
        </div>
        <span className="text-xs font-semibold text-[#a2533a]">3 →</span>
        <span className="text-[clamp(17px,1.8vw,21px)] leading-[1.25] font-semibold">
          How did you hear about us?<span className="text-[#e05d36]">*</span>
        </span>
        <div className="flex flex-col gap-[7px] text-sm">
          <span className="flex items-center gap-2.5 rounded-[10px] border-[1.5px] border-[#e05d36] bg-[#fbd6c6] px-3 py-2.5 font-semibold">
            <span className="grid size-5 place-items-center rounded-[5px] bg-[#e05d36] text-[11px] font-bold text-white">
              A
            </span>
            A friend told me
            <Check className="ml-auto size-4 text-[#e05d36]" />
          </span>
          {[
            ["B", "Search"],
            ["C", "A podcast"],
          ].map(([key, label]) => (
            <span
              key={key}
              className="flex items-center gap-2.5 rounded-[10px] border-[1.5px] border-[#f3c9b6] px-3 py-2.5"
            >
              <span className="grid size-5 place-items-center rounded-[5px] border border-[#e9a68c] text-[11px] font-bold">
                {key}
              </span>
              {label}
            </span>
          ))}
        </div>
        <span className="self-start rounded-full bg-[#e05d36] px-[22px] py-2.5 text-sm font-semibold text-white">
          OK ✓
        </span>
      </div>
      <div className="absolute bottom-[2%] left-0 flex -rotate-2 items-center gap-2.5 rounded-[10px] border-[1.5px] border-[#2b2118] bg-[#2b2118] px-4 py-3 text-sm text-[#fffaf1] shadow-[4px_4px_0_#f2b233]">
        <span className="size-2 rounded-full bg-[#4cc27f]" />
        <b>+1 response</b>
        <span className="text-[#b0a18e]">just now</span>
      </div>
    </div>
  );
}

const FEATURE_CARD =
  "flex flex-col overflow-hidden rounded-xl border-[1.5px] border-ink bg-background shadow-lift";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const accountDeleted = (await searchParams).account === "deleted";
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const heroCta = user ? "Go to dashboard" : "Start building for free";
  const heroHref = user ? "/dashboard" : "/signup";

  return (
    <div className="bg-background flex-1 overflow-hidden">
      <header className="mx-auto box-content flex max-w-[1200px] items-center gap-4 px-[clamp(16px,4vw,40px)] py-[18px]">
        <Brand />
        <div className="flex-1" />
        {user ? (
          <Link
            href="/dashboard"
            className="fc-focus border-ink bg-primary text-primary-foreground shadow-raised flex h-10 items-center rounded-sm border-[1.5px] px-4 text-[14.5px] font-bold whitespace-nowrap"
          >
            Go to dashboard
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="fc-focus rounded-xs px-1.5 py-2 text-[14.5px] font-semibold hover:underline"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="fc-focus border-ink bg-primary text-primary-foreground shadow-raised flex h-10 items-center rounded-sm border-[1.5px] px-4 text-[14.5px] font-bold whitespace-nowrap"
            >
              Sign up free
            </Link>
          </>
        )}
      </header>

      {accountDeleted && (
        <p
          role="status"
          className="text-muted-foreground mx-auto mb-2 max-w-[1200px] px-[clamp(16px,4vw,40px)] text-sm"
        >
          Your account and all its data have been deleted.
        </p>
      )}

      <main>
        <section className="mx-auto box-content flex max-w-[1200px] flex-wrap items-center gap-[clamp(40px,6vw,72px)] px-[clamp(16px,4vw,40px)] pt-[clamp(32px,7vw,88px)] pb-[clamp(48px,8vw,104px)]">
          <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-6">
            <span className="border-ink bg-card flex items-center gap-2 self-start rounded-full border-[1.5px] py-[5px] pr-3 pl-1.5 text-[13px] font-semibold">
              <span className="text-primary rounded-full bg-[#2b2118] px-2 py-0.5 text-[11px] font-bold tracking-[0.06em]">
                NEW
              </span>
              Branching logic you can actually read
            </span>
            <h1 className="font-heading text-[clamp(46px,7.4vw,92px)] leading-[0.95] font-bold tracking-[-0.045em] text-balance">
              Forms people{" "}
              <span className="border-ink bg-primary shadow-lift inline-block -rotate-2 rounded-[12px] border-[1.5px] px-[0.12em] text-[#2b2118]">
                actually
              </span>{" "}
              enjoy filling out.
            </h1>
            <p className="text-muted-foreground max-w-[520px] text-[clamp(16px,1.6vw,19px)] leading-[1.55] text-pretty">
              One question at a time, in your colours and your font. Branching logic,
              responses as they come in, and a link you can share anywhere.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href={heroHref} className={primaryCta}>
                {heroCta}
                <ArrowRight className="size-[18px]" />
              </Link>
              <Link
                href="/templates"
                className="fc-focus border-ink bg-card hover:bg-accent inline-flex h-[52px] items-center rounded-[8px] border-[1.5px] px-[22px] text-base font-semibold"
              >
                Browse templates
              </Link>
            </div>
            <span className="text-muted-foreground text-[13.5px]">
              Free while in beta. No card needed.
            </span>
          </div>
          <HeroArt />
        </section>

        <section className="border-ink bg-card border-t-[1.5px]">
          <div className="mx-auto box-content flex max-w-[1200px] flex-col gap-10 px-[clamp(16px,4vw,40px)] py-[clamp(48px,7vw,88px)]">
            <h2 className="font-heading max-w-[640px] text-[clamp(32px,4.4vw,52px)] leading-none font-bold tracking-[-0.035em] text-balance">
              Everything a form needs. Nothing it doesn&apos;t.
            </h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-5">
              <div className={FEATURE_CARD}>
                <div className="border-ink flex h-[180px] flex-wrap content-center gap-2 border-b-[1.5px] bg-[#f8e3b0] p-5">
                  {CHIPS.map(([name, Icon, rot]) => (
                    <span
                      key={name}
                      className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[#2b2118] bg-[#fffaf1] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#2b2118]"
                      style={{ transform: `rotate(${rot}deg)` }}
                    >
                      <Icon className="size-[13px]" />
                      {name}
                    </span>
                  ))}
                </div>
                <div className="flex flex-col gap-2 p-[22px]">
                  <h3 className="font-heading text-[22px] leading-[1.15] font-bold">
                    Build in minutes
                  </h3>
                  <p className="text-muted-foreground text-[15px] leading-[1.55]">
                    16 question types, easy reordering, branching logic and a theme
                    that&apos;s actually yours.
                  </p>
                </div>
              </div>
              <div className={FEATURE_CARD}>
                <div className="border-ink flex h-[180px] items-end gap-2.5 border-b-[1.5px] bg-[#dbe8f7] px-6 py-5 text-[#2b2118]">
                  <div className="flex flex-1 flex-col gap-1.5 self-center">
                    <span className="font-heading text-[40px] leading-none font-bold">
                      1,032
                    </span>
                    <span className="text-[13px] font-semibold">
                      responses · 68% complete
                    </span>
                  </div>
                  <div aria-hidden className="flex h-[110px] items-end gap-1.5">
                    {[30, 55, 42, 78, 100].map((h, i) => (
                      <span
                        key={h}
                        className="w-4 rounded-[3px] border-[1.5px] border-[#2b2118]"
                        style={{
                          height: `${h}%`,
                          background: i >= 3 ? "#f2b233" : "#fffaf1",
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2 p-[22px]">
                  <h3 className="font-heading text-[22px] leading-[1.15] font-bold">
                    See every response
                  </h3>
                  <p className="text-muted-foreground text-[15px] leading-[1.55]">
                    Completed and partial answers, a per-question summary, filters, and a
                    CSV whenever you want one.
                  </p>
                </div>
              </div>
              <div className={FEATURE_CARD}>
                <div className="border-ink flex h-[180px] items-center justify-center border-b-[1.5px] bg-[#e0e9d4] p-5 text-[#2b2118]">
                  <span className="size-14 -rotate-8 rounded-[12px] border-[1.5px] border-[#2b2118] bg-[#f2b233] shadow-[3px_3px_0_#2b2118]" />
                  <span className="w-12 border-t-[1.5px] border-dashed border-[#2b2118]" />
                  <div className="flex flex-col gap-2.5">
                    <span className="flex items-center gap-2 rounded-[8px] border-[1.5px] border-[#2b2118] bg-[#fffaf1] px-3 py-2 text-[13px] font-semibold">
                      <Webhook className="size-[15px]" />
                      Webhook
                    </span>
                    <span className="flex items-center gap-2 rounded-[8px] border-[1.5px] border-[#2b2118] bg-[#fffaf1] px-3 py-2 text-[13px] font-semibold">
                      <Sheet className="size-[15px] text-[#2f9e5f]" />
                      Google Sheets
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 p-[22px]">
                  <h3 className="font-heading text-[22px] leading-[1.15] font-bold">
                    Connect your stack
                  </h3>
                  <p className="text-muted-foreground text-[15px] leading-[1.55]">
                    Signed webhooks to your own server, or a new row in Google Sheets for
                    every completed response.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#2b2118] text-[#fffaf1]">
          <div className="mx-auto box-content flex max-w-[1200px] flex-wrap items-center justify-between gap-6 px-[clamp(16px,4vw,40px)] py-[clamp(48px,7vw,80px)]">
            <h2 className="font-heading max-w-[620px] text-[clamp(30px,4vw,48px)] leading-[1.02] font-bold tracking-[-0.035em]">
              Your first form takes about two minutes.
            </h2>
            <Link
              href={heroHref}
              className="inline-flex h-[52px] items-center rounded-[8px] border-[1.5px] border-[#fffaf1] bg-[#f2b233] px-6 text-base font-bold text-[#2b2118] shadow-[4px_4px_0_#fffaf1] outline-none focus-visible:shadow-[4px_4px_0_#fffaf1,0_0_0_2px_#2b2118,0_0_0_4px_#fffaf1]"
            >
              {heroCta}
            </Link>
          </div>
        </section>
      </main>

      <footer className="text-muted-foreground mx-auto box-content flex max-w-[1200px] flex-wrap items-center gap-x-7 gap-y-4 px-[clamp(16px,4vw,40px)] py-7 text-[13.5px]">
        <span className="text-foreground flex items-center gap-2 font-bold">
          <LogoMark size={14} />
          FormCraft
        </span>
        <span>© 2026 FormCraft</span>
        <div className="flex-1" />
        <Link href="/templates" className="hover:underline">
          Templates
        </Link>
      </footer>
    </div>
  );
}
