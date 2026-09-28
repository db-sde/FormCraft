import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const FEATURES = [
  {
    title: "Build in minutes",
    description:
      "16 question types, branching logic, and theming — no code, just drag and drop.",
  },
  {
    title: "See every response",
    description:
      "Partial and completed responses, a live dashboard, and one-click CSV export.",
  },
  {
    title: "Connect your stack",
    description: "Webhooks and Google Sheets sync push new responses wherever you work.",
  },
];

export default async function Home() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 items-center justify-between border-b px-6">
        <span className="font-semibold tracking-tight">FormCraft</span>
        <div className="flex items-center gap-4">
          {user ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
          ) : (
            <>
              <Link
                href="/login"
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                Log in
              </Link>
              <Button asChild size="sm">
                <Link href="/signup">Sign up free</Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 py-24">
        <div className="max-w-2xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Forms people actually enjoy filling out.
          </h1>
          <p className="text-muted-foreground mt-6 text-lg text-balance">
            Build conversational forms, publish them in seconds, and watch responses come
            in — with the logic, theming, and integrations a real product needs.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href={user ? "/dashboard" : "/signup"}>
                {user ? "Go to dashboard" : "Start building for free"}
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/templates">Browse templates</Link>
            </Button>
          </div>
        </div>

        <div className="mt-20 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title}>
              <CardContent className="pt-2">
                <h2 className="font-medium">{feature.title}</h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
