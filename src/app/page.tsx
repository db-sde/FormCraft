import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Check,
  GitBranch,
  Hourglass,
  MessageSquareText,
  Palette,
  Plug,
  UsersRound,
} from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/app-shell/brand";

const FEATURES = [
  {
    icon: MessageSquareText,
    title: "One question at a time",
    text: "Conversational forms with 17 question types that feel effortless on any phone.",
  },
  {
    icon: UsersRound,
    title: "Lead capture that sticks",
    text: "Ask for contact details before the last question — they're saved the moment they're typed, even if the person never submits.",
  },
  {
    icon: Hourglass,
    title: "See who didn't finish",
    text: "Every answer autosaves. Incomplete responses show exactly where people stopped.",
  },
  {
    icon: GitBranch,
    title: "Logic & branching",
    text: "Skip questions or jump to a different ending based on what people answer.",
  },
  {
    icon: Palette,
    title: "On-brand design",
    text: "Your colours, fonts, logo and button style — with a live preview as you build.",
  },
  {
    icon: Plug,
    title: "Send data anywhere",
    text: "Webhooks, Google Sheets sync and one-click CSV export for responses and leads.",
  },
];

const STEPS = [
  { title: "Build", text: "Start from a template or scratch. Lead capture is included." },
  { title: "Share", text: "Publish to get a link, or embed the form on your website." },
  {
    title: "Follow up",
    text: "Every lead and response lands in your dashboard instantly.",
  },
];

/** A static illustration of the product: a form screen and the leads list. */
function ProductPreview() {
  return (
    <div className="relative mx-auto mt-16 grid max-w-5xl gap-4 md:grid-cols-[1.1fr_1fr]">
      <div className="bg-card rounded-2xl border p-6 shadow-xl shadow-indigo-500/5 sm:p-8">
        <div className="bg-muted mb-6 h-1 overflow-hidden rounded-full">
          <div className="bg-primary h-full w-2/3 rounded-full" />
        </div>
        <p className="text-lg font-semibold">Where can we reach you?</p>
        <p className="text-muted-foreground mt-1 text-sm">
          We&apos;ll only use this to get back to you.
        </p>
        <div className="mt-5 grid gap-3">
          {[
            ["Name", "Ada Lovelace"],
            ["Email", "ada@analytical.io"],
            ["Phone", "+44 20 7946 0958"],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-muted-foreground mb-1 text-xs font-medium">{label}</p>
              <div className="rounded-md border px-3 py-2 text-sm">{value}</div>
            </div>
          ))}
        </div>
        <span className="bg-primary text-primary-foreground mt-5 inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-medium">
          OK <ArrowRight className="size-4" />
        </span>
      </div>
      <div className="bg-card rounded-2xl border p-5 shadow-xl shadow-indigo-500/5">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-semibold">Leads</p>
          <span className="text-muted-foreground text-xs">Just now</span>
        </div>
        <div className="divide-y text-sm">
          {[
            ["Ada Lovelace", "ada@analytical.io", false],
            ["Grace Hopper", "grace@navy.mil", true],
            ["Alan Turing", "alan@bletchley.uk", true],
            ["Katherine Johnson", "kj@nasa.gov", false],
          ].map(([name, email, done]) => (
            <div
              key={name as string}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{name}</p>
                <p className="text-muted-foreground truncate text-xs">{email}</p>
              </div>
              <span
                className={
                  done
                    ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                    : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                }
              >
                {done ? "Completed" : "Didn't finish"}
              </span>
            </div>
          ))}
        </div>
        <div className="bg-muted/60 mt-4 flex items-center gap-2 rounded-lg p-3 text-xs">
          <BarChart3 className="text-primary size-4" />
          <span>
            <strong>2 leads</strong> saved from people who didn&apos;t finish the form
          </span>
        </div>
      </div>
    </div>
  );
}

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
  const primaryHref = user ? "/dashboard" : "/signup";

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <nav className="text-muted-foreground hidden items-center gap-6 text-sm md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-foreground">
              How it works
            </a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Button asChild>
                <Link href="/dashboard">Go to dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost">
                  <Link href="/login">Log in</Link>
                </Button>
                <Button asChild>
                  <Link href="/signup">Get started free</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {accountDeleted && (
        <p
          role="status"
          className="bg-muted text-foreground border-b px-4 py-3 text-center text-sm"
        >
          Your account and all its data have been deleted.
        </p>
      )}
      <main className="flex-1">
        <section className="relative overflow-hidden px-4 pt-16 pb-20 sm:px-6 sm:pt-24">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-indigo-50 to-transparent"
          />
          <div className="mx-auto max-w-3xl text-center">
            <span className="bg-background text-accent-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
              <UsersRound className="size-3.5" />
              Lead capture built in
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Forms people finish. Leads you never lose.
            </h1>
            <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg text-balance">
              Build beautiful, conversational forms in minutes. Every answer saves as
              people type — so you keep their contact details even when they don&apos;t
              make it to the end.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-11 px-6">
                <Link href={primaryHref}>
                  {user ? "Go to dashboard" : "Start building for free"}
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-6">
                <Link href="/templates">Browse templates</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-4 flex items-center justify-center gap-4 text-xs">
              <span className="flex items-center gap-1">
                <Check className="size-3.5" /> Free to start
              </span>
              <span className="flex items-center gap-1">
                <Check className="size-3.5" /> No credit card
              </span>
            </p>
          </div>
          <ProductPreview />
        </section>

        <section id="features" className="border-t px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight">
                Everything you need to turn visitors into leads
              </h2>
              <p className="text-muted-foreground mt-3">
                From the first question to the follow-up email.
              </p>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="bg-card rounded-xl border p-6">
                  <span className="bg-accent text-accent-foreground grid size-10 place-items-center rounded-lg">
                    <feature.icon className="size-5" />
                  </span>
                  <h3 className="mt-4 font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm">{feature.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="bg-canvas border-t px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-3xl font-semibold tracking-tight">
              Live in three steps
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <div key={step.title} className="text-center">
                  <span className="bg-primary text-primary-foreground mx-auto grid size-10 place-items-center rounded-full font-semibold">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-20 sm:px-6">
          <div className="bg-primary text-primary-foreground mx-auto max-w-5xl rounded-2xl px-6 py-14 text-center">
            <h2 className="text-3xl font-semibold tracking-tight">
              Your next lead is one form away
            </h2>
            <p className="mx-auto mt-3 max-w-xl opacity-80">
              Create your first form in under five minutes. Free while you get started.
            </p>
            <Button asChild size="lg" variant="secondary" className="mt-8 h-11 px-6">
              <Link href={primaryHref}>
                {user ? "Go to dashboard" : "Get started free"}
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t px-4 py-8 sm:px-6">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm sm:flex-row">
          <Brand />
          <p>© {new Date().getFullYear()} FormCraft. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
