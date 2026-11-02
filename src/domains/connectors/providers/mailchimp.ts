import { createHash } from "node:crypto";
import { MailchimpSettings, type FieldInfo } from "../catalog";
import {
  providerCall,
  registerAction,
  updateConnectionSettings,
  type ActionResult,
  type Connection,
} from "../framework";
import { asText, loadSync, mappingProblem } from "../links";
import { emailFrom } from "../mapping";
import { byName, configCall, type ApiCtx, type ProviderAdapter } from "./shared";

/**
 * Mailchimp (F-38). A respondent is added to (or updated in) an audience:
 * a PUT on the member's id — the md5 of their lowercased email — so a
 * retry or a second response updates the same contact. Consent: with a
 * consent question, only people who answered yes are sent (others are
 * recorded as skipped); new contacts are `pending` (Mailchimp emails them
 * to confirm) when double opt-in is on, which is the default. Existing
 * contacts keep their status — someone who unsubscribed stays so. Tags
 * are added, never removed. Mailchimp allows 10 concurrent connections;
 * 429 retries with backoff.
 */

const METADATA = "https://login.mailchimp.com/oauth2/metadata";

export const memberId = (email: string) =>
  createHash("md5").update(email.trim().toLowerCase()).digest("hex");

const SUPPORTED = new Set([
  "text",
  "number",
  "phone",
  "date",
  "url",
  "imageurl",
  "radio",
  "dropdown",
  "zip",
]);

/** The account's data center ("us21"), read once and kept on the
 * connection: Mailchimp's API host depends on it. */
async function apiBase(
  connection: Connection,
  fetcher: typeof fetch,
  admin: ApiCtx["admin"],
): Promise<string | null> {
  let dc = typeof connection.settings.dc === "string" ? connection.settings.dc : null;
  if (!dc) {
    const res = await fetcher(METADATA, {
      headers: {
        authorization: `OAuth ${connection.tokens.accessToken}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const meta = res?.ok ? ((await res.json()) as { dc?: unknown }) : null;
    dc = typeof meta?.dc === "string" ? meta.dc : null;
    if (!dc || !/^[a-z]+\d+$/.test(dc)) return null;
    connection.settings = { ...connection.settings, dc };
    await updateConnectionSettings(admin, connection.id, connection.settings);
  }
  if (!/^[a-z]+\d+$/.test(dc)) return null;
  return `https://${dc}.api.mailchimp.com/3.0`;
}

async function base(ctx: ApiCtx) {
  const url = await apiBase(ctx.connection, ctx.fetch, ctx.admin);
  if (!url) throw new Error("Couldn't find the Mailchimp account's data center");
  return url;
}

export const mailchimp: ProviderAdapter = {
  async choices(ctx, source) {
    if (source !== "audiences") return [];
    const data = await configCall<{ lists?: { id: string; name: string }[] }>(
      ctx,
      `${await base(ctx)}/lists?count=100&fields=lists.id,lists.name`,
    );
    return (data.lists ?? []).map((l) => ({ id: l.id, name: l.name })).sort(byName);
  },
  async fields(ctx, settings) {
    const id = (settings as { audienceId?: string }).audienceId;
    if (!id) return [];
    const data = await configCall<{
      merge_fields?: { tag: string; name: string; type: string; required: boolean }[];
    }>(ctx, `${await base(ctx)}/lists/${encodeURIComponent(id)}/merge-fields?count=100`);
    return (data.merge_fields ?? []).map((f): FieldInfo => ({
      key: f.tag,
      label: f.name,
      type: f.type,
      required: f.required,
      supported: SUPPORTED.has(f.type),
    }));
  },
};

registerAction(
  "mailchimp",
  "sync_response",
  async (job, { admin, connection, fetch }) => {
    const loaded = await loadSync(admin, job);
    if (!loaded.ok) return loaded.result;
    const { link, response, fields } = loaded.input;
    const parsed = MailchimpSettings.safeParse(link.settings);
    if (!parsed.success) return mappingProblem("Choose an audience and the email answer");
    const settings = parsed.data;

    if (settings.consentQuestionId) {
      const onPath = response.path.some((q) => q.id === settings.consentQuestionId);
      if (!onPath || response.answers[settings.consentQuestionId] !== true) {
        return { ok: true, skipped: "No marketing consent" };
      }
    }
    const email = emailFrom(response, settings.emailSource);
    if (!email) return { ok: true, skipped: "No email address in the response" };

    const root = await apiBase(connection, fetch, admin);
    if (!root)
      return { ok: false, retry: true, error: "Couldn't find the account's data center" };
    const token = connection.tokens.accessToken;

    const mergeFields: Record<string, unknown> = {};
    for (const [tag, value] of Object.entries(fields)) {
      if (tag === "EMAIL") continue;
      mergeFields[tag] = typeof value === "string" ? asText(value, 255) : value;
    }
    const member = `${root}/lists/${encodeURIComponent(settings.audienceId)}/members/${memberId(email)}`;
    const res = await providerCall(fetch, member, {
      token,
      method: "PUT",
      body: JSON.stringify({
        email_address: email,
        status_if_new: settings.doubleOptIn ? "pending" : "subscribed",
        ...(Object.keys(mergeFields).length ? { merge_fields: mergeFields } : {}),
      }),
    });
    if (!res.ok) return res.result;
    if (settings.tags.length) {
      const tagged = await providerCall(fetch, `${member}/tags`, {
        token,
        method: "POST",
        body: JSON.stringify({
          tags: settings.tags.map((name) => ({ name, status: "active" })),
        }),
      });
      if (!tagged.ok) return tagged.result;
    }
    return {
      ok: true,
      result: {
        member: memberId(email),
        status: (res.data as { status?: string }).status,
      },
    } satisfies ActionResult;
  },
);
