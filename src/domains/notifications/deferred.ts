import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { renderEmailHtml } from "./email-layout";
import { defaultSender, type Send } from "./mailer";

type Client = SupabaseClient<Database>;

/**
 * When a workspace has used its emails for the month, owner notifications
 * stop and are counted instead (pricing doc: "emails switch to the daily
 * digest instead of failing quietly"). Once a day the owner gets one
 * summary of what was held back. It isn't counted against the allowance:
 * it's at most one email a day, and it's how they learn the rest stopped.
 */
export async function sendDeferredSummaries(
  admin: Client,
  options: { send?: Send | null } = {},
): Promise<{ sent: number }> {
  const send = options.send === undefined ? defaultSender() : options.send;
  const { data: rows } = await admin.rpc("ops_claim_deferred_notifications");
  if (!rows?.length) return { sent: 0 };

  const byWorkspace = new Map<
    string,
    { formId: string; day: string; responses: number }[]
  >();
  for (const r of rows) {
    const list = byWorkspace.get(r.workspace_id) ?? [];
    list.push({ formId: r.form_id, day: r.day, responses: r.responses });
    byWorkspace.set(r.workspace_id, list);
  }
  if (!send) return { sent: 0 };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  let sent = 0;
  for (const [workspaceId, items] of byWorkspace) {
    const { data: ws } = await admin
      .from("workspaces")
      .select("name, owner:profiles!workspaces_owner_id_fkey(email)")
      .eq("id", workspaceId)
      .maybeSingle();
    const to = (ws?.owner as { email: string | null } | null)?.email;
    if (!ws || !to) continue;
    const { data: forms } = await admin
      .from("forms")
      .select("id, title")
      .in(
        "id",
        items.map((i) => i.formId),
      );
    const title = (id: string) => forms?.find((f) => f.id === id)?.title || "A form";
    const total = items.reduce((n, i) => n + i.responses, 0);
    const lines = items.map(
      (i) =>
        `${title(i.formId)}: ${i.responses} new response${i.responses === 1 ? "" : "s"}`,
    );
    const body = `${ws.name} has used this month's notification emails, so FormCraft sends one summary a day instead of an email per response. Every response is saved as usual.`;
    const result = await send({
      to: [to],
      subject: `${total} new response${total === 1 ? "" : "s"} in ${ws.name}`.slice(
        0,
        200,
      ),
      text: [body, "", ...lines, "", `Upgrade or see usage: ${appUrl}/settings`].join(
        "\n",
      ),
      html: renderEmailHtml({
        tag: "Daily summary",
        tagColor: "#e4ecfb",
        title: `${total} new response${total === 1 ? "" : "s"}`,
        body,
        meta: lines.map((l) => {
          const [label, ...rest] = l.split(": ");
          return { label, value: rest.join(": ") };
        }),
        button: { label: "See your plan and usage", href: `${appUrl}/settings` },
        fine: "Per-response emails start again when your allowance resets next month.",
      }),
    });
    if (result.ok) sent += 1;
  }
  return { sent };
}
