import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/app-shell/brand";
import { Button } from "@/components/ui/button";
import { previewInvitation, ROLE_DESCRIPTION, ROLE_LABEL } from "@/domains/workspaces";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AcceptInvitation } from "./accept-invitation";

export const metadata: Metadata = {
  title: "Invitation",
  robots: { index: false },
  // The token is in this URL: don't leak it to other sites.
  referrer: "no-referrer",
};

/** A workspace invitation link (P2.19). Anyone can open it; accepting
 * needs an account with the invited email address. */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await previewInvitation(createAdminClient(), token);
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  const here = `/invite/${token}`;

  return (
    <div className="bg-background flex min-h-dvh flex-col items-center gap-6 px-5 py-14">
      <Brand />
      <main className="border-ink bg-card shadow-card flex w-full max-w-[420px] flex-col gap-4 rounded-lg border-[1.5px] p-7">
        {!invitation ? (
          <>
            <h1 className="font-heading text-[26px] leading-tight font-bold">
              This invitation doesn&apos;t work
            </h1>
            <p className="text-muted-foreground text-[15px] leading-normal">
              It may have expired (invitations last 7 days), been used already, or been
              cancelled. Ask the person who invited you for a new one.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-heading text-[26px] leading-tight font-bold">
              Join {invitation.workspaceName}
            </h1>
            <p className="text-[15px] leading-normal">
              You&apos;re invited as <b>{ROLE_LABEL[invitation.role]}</b>:{" "}
              {ROLE_DESCRIPTION[invitation.role].toLowerCase()}
            </p>
            {!user ? (
              <>
                <p className="text-muted-foreground text-sm">
                  Sign in or create an account with <b>{invitation.email}</b> to accept.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  <Button asChild>
                    <Link href={`/login?next=${encodeURIComponent(here)}`}>Log in</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={`/signup?next=${encodeURIComponent(here)}`}>
                      Create an account
                    </Link>
                  </Button>
                </div>
              </>
            ) : (user.email ?? "").toLowerCase() !== invitation.email ? (
              <p className="text-sm text-[var(--alert-error-fg)]">
                This invitation is for <b>{invitation.email}</b>, but you&apos;re signed
                in as <b>{user.email}</b>. Sign in with the invited address to accept it.
              </p>
            ) : (
              <AcceptInvitation token={token} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
