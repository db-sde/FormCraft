import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { defaultSender } from "@/domains/notifications/mailer";
import { renderEmailHtml } from "@/domains/notifications/email-layout";
import type { ApiCaller } from "./keys";

type Client = SupabaseClient<Database>;

export type ApiTake = {
  allowed: boolean;
  scope: "minute" | "day" | null;
  retry_after: number;
  /** Requests per minute (null: no per-minute limit). */
  limit: number | null;
  remaining: number;
  /** Seconds until the bucket is full again. */
  reset: number;
  daily_remaining: number | null;
  first_day_cap: boolean;
};

/**
 * Takes one API request for the caller's workspace (developer spec item
 * 5): a token bucket refilled at the plan's per-minute rate and as big as
 * its burst, and a daily count that resets at 00:00 UTC. Atomic in the
 * database, so it holds across Vercel instances. The plan is read on
 * every request, so an upgrade applies at once.
 */
export async function takeApiRequest(admin: Client, caller: ApiCaller): Promise<ApiTake> {
  const { data, error } = await admin.rpc("api_take", {
    p_workspace_id: caller.workspaceId,
    p_per_minute: caller.perMinute as number,
    p_burst: caller.burst as number,
    p_per_day: caller.perDay as number,
  });
  if (error || !data) {
    // The limiter being down mustn't take the API down with it.
    return {
      allowed: true,
      scope: null,
      retry_after: 0,
      limit: caller.perMinute,
      remaining: caller.burst ?? 0,
      reset: 0,
      daily_remaining: caller.perDay,
      first_day_cap: false,
    };
  }
  return data as unknown as ApiTake;
}

/** Emails the owner the first time in a UTC day the workspace hits its
 * daily API cap (a FormCraft system email, not counted against quotas). */
export async function notifyDailyCap(
  admin: Client,
  workspaceId: string,
  perDay: number | null,
): Promise<void> {
  const send = defaultSender();
  if (!send) return;
  try {
    const { data: ws } = await admin
      .from("workspaces")
      .select("name, owner:profiles!workspaces_owner_id_fkey(email)")
      .eq("id", workspaceId)
      .maybeSingle();
    const to = (ws?.owner as { email: string | null } | null)?.email;
    if (!ws || !to) return;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const body = `${ws.name} has made ${perDay?.toLocaleString() ?? "its"} API requests today, its plan's daily limit. Further requests get HTTP 429 until 00:00 UTC. Zapier, Make and n8n retry on their own.`;
    await send({
      to: [to],
      subject: `${ws.name} reached today's API limit`.slice(0, 200),
      text: `${body}\n\nSee API usage or upgrade: ${appUrl}/settings?tab=api`,
      html: renderEmailHtml({
        tag: "API",
        tagColor: "#e4ecfb",
        title: "Today's API limit is used",
        body,
        button: { label: "See API usage", href: `${appUrl}/settings?tab=api` },
        fine: "You get this email once a day at most.",
      }),
    });
  } catch {
    // Best effort: the 429 itself tells the caller.
  }
}
