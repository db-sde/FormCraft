import type { Tokens } from "./oauth";

/**
 * A safe label for a new connection: the account's email or name, read
 * with the new token. Best effort; never a secret.
 */
export async function accountLabel(
  provider: string,
  tokens: Tokens,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const get = async (url: string, headers: Record<string, string> = {}) => {
    const res = await fetcher(url, {
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        accept: "application/json",
        ...headers,
      },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  };
  switch (provider) {
    case "google_calendar": {
      const me = await get("https://www.googleapis.com/oauth2/v2/userinfo");
      return typeof me?.email === "string" ? me.email : null;
    }
    case "airtable": {
      const me = await get(
        `${process.env.AIRTABLE_API_BASE ?? "https://api.airtable.com"}/v0/meta/whoami`,
      );
      return typeof me?.email === "string" ? me.email : "Airtable account";
    }
    case "salesforce":
      return tokens.extra?.instance_url
        ? new URL(tokens.extra.instance_url).host
        : "Salesforce";
    case "notion":
      return tokens.extra?.workspace_name ?? "Notion workspace";
    case "mailchimp": {
      const meta = await get("https://login.mailchimp.com/oauth2/metadata", {
        authorization: `OAuth ${tokens.accessToken}`,
      });
      return typeof meta?.accountname === "string"
        ? meta.accountname
        : "Mailchimp account";
    }
    case "zoho_crm":
      return tokens.extra?.api_domain
        ? new URL(tokens.extra.api_domain).host
        : "Zoho CRM";
    case "pipedrive": {
      // OAuth tokens work on the company's own domain (api_domain).
      const base = tokens.extra?.api_domain;
      if (!base || !/^https:\/\/[a-z0-9-]+\.pipedrive\.com$/.test(base))
        return "Pipedrive account";
      const me = await get(`${base}/api/v1/users/me`);
      const data = me?.data as { email?: string; company_name?: string } | undefined;
      return data?.company_name ?? data?.email ?? "Pipedrive account";
    }
    default:
      return null;
  }
}
