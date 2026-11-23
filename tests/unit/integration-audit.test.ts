import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createConnectState,
  exchangeCode,
  OAUTH_PROVIDERS,
  refreshIfNeeded,
  unverifiedReturnPath,
  zohoAccountsServer,
} from "@/domains/connectors/oauth";
import { APPS } from "@/domains/connectors/catalog";
import { asDate, asDateTime } from "@/domains/connectors/links";
import { airtableValue } from "@/domains/connectors/providers/airtable";
import { notionValue } from "@/domains/connectors/providers/notion";
import { salesforceValue } from "@/domains/connectors/providers/salesforce";
import { zohoValue } from "@/domains/connectors/providers/zoho";
import { pipedriveValue } from "@/domains/connectors/providers/pipedrive";
import { accountLabel } from "@/domains/connectors/accounts";
import { formatDateTime } from "@/domains/logic/datetime";

/**
 * Regression tests for the integration audit (roadmap v3.1 §J,
 * docs/integration-audit.md): Zoho accounts outside the US data centre,
 * date-time answers sent to apps' date fields, an expired connection
 * flow landing where it started, and no deferred provider offered as a
 * connector.
 */

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

function recordingFetch(body: Record<string, unknown>) {
  const calls: { url: string; body: string }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("Zoho CRM data centres (F-40)", () => {
  it("accepts only Zoho's own accounts servers", () => {
    expect(zohoAccountsServer("https://accounts.zoho.in")).toBe(
      "https://accounts.zoho.in",
    );
    expect(zohoAccountsServer("https://accounts.zoho.eu")).toBe(
      "https://accounts.zoho.eu",
    );
    expect(zohoAccountsServer("https://accounts.zoho.com.au")).toBe(
      "https://accounts.zoho.com.au",
    );
    for (const bad of [
      "http://accounts.zoho.in",
      "https://accounts.zoho.in.evil.example",
      "https://evil.example",
      "https://accounts.zoho.in/oauth/v2/token",
      "https://user@accounts.zoho.in",
      "https://accounts.zoho.in:8443",
      "accounts.zoho.in",
      "",
      null,
    ]) {
      expect(zohoAccountsServer(bad)).toBeNull();
    }
  });

  it("exchanges an Indian account's code with Zoho India, and refreshes there", async () => {
    process.env.ZOHO_CLIENT_ID = "zid";
    process.env.ZOHO_CLIENT_SECRET = "zsecret";
    const { fetcher, calls } = recordingFetch({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      api_domain: "https://www.zohoapis.in",
    });
    const tokens = await exchangeCode(
      "zoho_crm",
      "code",
      "nonce",
      fetcher,
      "https://accounts.zoho.in",
    );
    expect(calls[0].url).toBe("https://accounts.zoho.in/oauth/v2/token");
    expect(tokens.extra).toEqual({
      api_domain: "https://www.zohoapis.in",
      accounts_server: "https://accounts.zoho.in",
    });

    const refresh = recordingFetch({ access_token: "at2", expires_in: 3600 });
    const next = await refreshIfNeeded(
      "zoho_crm",
      { ...tokens, expiresAt: 0 },
      refresh.fetcher,
    );
    expect(refresh.calls[0].url).toBe("https://accounts.zoho.in/oauth/v2/token");
    expect(refresh.calls[0].body).toContain("grant_type=refresh_token");
    expect(next.tokens.refreshToken).toBe("rt");
    expect(next.tokens.extra?.accounts_server).toBe("https://accounts.zoho.in");
  });

  it("never sends the client secret to a server that isn't Zoho's", async () => {
    process.env.ZOHO_CLIENT_ID = "zid";
    process.env.ZOHO_CLIENT_SECRET = "zsecret";
    const { fetcher, calls } = recordingFetch({ access_token: "at" });
    const tokens = await exchangeCode(
      "zoho_crm",
      "code",
      "nonce",
      fetcher,
      "https://accounts.zoho.in.evil.example",
    );
    expect(calls[0].url).toBe("https://accounts.zoho.com/oauth/v2/token");
    expect(tokens.extra).toBeUndefined();
  });

  it("ignores accounts-server for every other provider", async () => {
    process.env.PIPEDRIVE_CLIENT_ID = "pid";
    process.env.PIPEDRIVE_CLIENT_SECRET = "psecret";
    const { fetcher, calls } = recordingFetch({ access_token: "at" });
    await exchangeCode("pipedrive", "code", "nonce", fetcher, "https://accounts.zoho.in");
    expect(calls[0].url).toBe(OAUTH_PROVIDERS.pipedrive.tokenUrl);
  });
});

describe("a connection flow that can't be verified", () => {
  it("goes back to the page it started from, never off the site", () => {
    process.env.APP_SECRET = "a".repeat(32);
    const { state } = createConnectState({
      provider: "airtable",
      workspaceId: "w",
      userId: "u",
      personal: false,
      returnTo: "/forms/abc/integrations",
    });
    expect(unverifiedReturnPath(state)).toBe("/forms/abc/integrations");
    const forged = (r: string) =>
      `${Buffer.from(JSON.stringify({ r })).toString("base64url")}.sig`;
    expect(unverifiedReturnPath(forged("//evil.example"))).toBe("/settings");
    expect(unverifiedReturnPath(forged("https://evil.example"))).toBe("/settings");
    expect(unverifiedReturnPath("garbage")).toBe("/settings");
    expect(unverifiedReturnPath(null)).toBe("/settings");
  });

  it("is explained wherever it lands", () => {
    const callback = readFileSync(
      "src/app/api/connectors/oauth/callback/route.ts",
      "utf8",
    );
    expect(callback).toContain("unverifiedReturnPath");
    for (const page of [
      "src/app/(form)/forms/[id]/(sections)/integrations/page.tsx",
      "src/app/(dashboard)/bookings/page.tsx",
      "src/app/(dashboard)/settings/page.tsx",
    ]) {
      expect(readFileSync(page, "utf8")).toMatch(/expired/);
    }
  });
});

describe("dates and date-times sent to apps", () => {
  // What the mapping sends for a date-time answer (formatAnswerValue).
  const shown = formatDateTime("2026-11-20T14:00+05:30");

  it("reads the mapped date-time and ISO strings as one UTC moment", () => {
    expect(shown).toBe("2026-11-20 14:00 (UTC+05:30)");
    expect(asDateTime(shown)).toBe("2026-11-20T08:30:00.000Z");
    expect(asDateTime(formatDateTime("2026-11-20T09:15Z"))).toBe(
      "2026-11-20T09:15:00.000Z",
    );
    expect(asDateTime(formatDateTime("2026-11-20T00:30+05:30", "12"))).toBe(
      "2026-11-19T19:00:00.000Z",
    );
    expect(asDateTime(formatDateTime("2026-11-20T13:05Z", "12"))).toBe(
      "2026-11-20T13:05:00.000Z",
    );
    expect(asDateTime("2026-11-20T10:00:00.000Z")).toBe("2026-11-20T10:00:00.000Z");
    expect(asDateTime("2026-11-20")).toBeNull();
    expect(asDateTime("next Tuesday")).toBeNull();
    expect(asDateTime(42)).toBeNull();
  });

  it("takes a calendar date only from a value that starts with one", () => {
    expect(asDate("2026-11-20")).toBe("2026-11-20");
    expect(asDate(shown)).toBe("2026-11-20");
    expect(asDate("Tue, 3 Nov 2026, 14:00 (Europe/London)")).toBeNull();
    expect(asDate(true)).toBeNull();
  });

  it("gives each app's date-time field a value it accepts", () => {
    expect(salesforceValue("datetime", shown)).toBe("2026-11-20T08:30:00.000Z");
    expect(salesforceValue("date", shown)).toBe("2026-11-20");
    expect(salesforceValue("date", "3 Nov 2026")).toBeNull();
    expect(zohoValue("datetime", shown)).toBe("2026-11-20T08:30:00+00:00");
    expect(zohoValue("date", "3 Nov 2026")).toBeNull();
    expect(airtableValue("dateTime", shown)).toEqual({
      ok: true,
      value: "2026-11-20T08:30:00.000Z",
    });
    expect(airtableValue("date", "3 Nov 2026")).toMatchObject({ ok: false });
    expect(notionValue("date", shown)).toEqual({
      ok: true,
      value: { date: { start: "2026-11-20T08:30:00.000Z" } },
    });
    expect(notionValue("date", "2026-11-20")).toEqual({
      ok: true,
      value: { date: { start: "2026-11-20" } },
    });
    expect(notionValue("date", "soon")).toMatchObject({ ok: false });
    expect(
      pipedriveValue({ key: "d", name: "Date", field_type: "date" }, "3 Nov 2026"),
    ).toBeNull();
  });
});

describe("connection labels", () => {
  it("asks Pipedrive on the company's own domain, and nowhere else", async () => {
    const urls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ data: { company_name: "Acme" } }));
    }) as typeof fetch;
    expect(
      await accountLabel(
        "pipedrive",
        { accessToken: "t", extra: { api_domain: "https://acme.pipedrive.com" } },
        fetcher,
      ),
    ).toBe("Acme");
    expect(urls).toEqual(["https://acme.pipedrive.com/api/v1/users/me"]);
    expect(
      await accountLabel(
        "pipedrive",
        { accessToken: "t", extra: { api_domain: "https://evil.example" } },
        fetcher,
      ),
    ).toBe("Pipedrive account");
    expect(urls).toHaveLength(1);
  });

  it("asks Airtable at the configured API (a stand-in in tests)", async () => {
    process.env.AIRTABLE_API_BASE = "http://127.0.0.1:4602";
    const urls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ email: "ana@example.com" }));
    }) as typeof fetch;
    expect(await accountLabel("airtable", { accessToken: "t" }, fetcher)).toBe(
      "ana@example.com",
    );
    expect(urls).toEqual(["http://127.0.0.1:4602/v0/meta/whoami"]);
  });
});

describe("only approved connectors are offered (roadmap v3.1 §J1.4)", () => {
  // Build Now (#33, #34, #36, #38, #40, #43, #50). PayPal (#37),
  // Microsoft 365 (#39), SMS (#41), WhatsApp (#42), Zendesk/Intercom
  // (#45) and custom SMTP (#57) are Build Later: never a Connect button.
  const APPROVED = [
    "airtable",
    "salesforce",
    "notion",
    "mailchimp",
    "zoho_crm",
    "pipedrive",
    "google_drive",
    "google_calendar",
  ];
  const DEFERRED =
    /paypal|microsoft|outlook|office|teams|onedrive|twilio|msg91|sms|whatsapp|zendesk|intercom|smtp/i;

  it("has no OAuth provider or app card outside the approved list", () => {
    expect(Object.keys(OAUTH_PROVIDERS).sort()).toEqual([...APPROVED].sort());
    for (const app of APPS) expect(APPROVED).toContain(app.provider);
    for (const name of [
      ...Object.values(OAUTH_PROVIDERS).map((p) => `${p.provider} ${p.label}`),
      ...APPS.map((a) => `${a.provider} ${a.label}`),
    ]) {
      expect(name).not.toMatch(DEFERRED);
    }
  });

  it("doesn't claim a Zapier or Make app that isn't listed in their directories", () => {
    const copy = readFileSync("src/components/dashboard/api-key-settings.tsx", "utf8");
    expect(copy).not.toMatch(/Connect Zapier/);
    expect(copy).toMatch(/isn't in the Zapier or Make app directories yet/);
  });

  it("never promises that a missing feature is about to arrive", () => {
    const files = [
      "src/lib/not-set-up.ts",
      "src/components/forms/form-access-panel.tsx",
      "src/app/(dashboard)/settings/team-actions.ts",
      "src/app/(form)/forms/[id]/(sections)/integrations/page.tsx",
    ];
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(
        /almost here|finishing touches|on their way/i,
      );
    }
  });
});
