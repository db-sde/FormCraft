import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * OAuth 2.0 for every connector (master spec §5.3): one authorize →
 * callback → token flow, configured per provider. Each provider needs an
 * app registered with it; its client id and secret come from
 * `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET` (documented in
 * .env.example), and the redirect URI is always
 * `${NEXT_PUBLIC_APP_URL}/api/connectors/oauth/callback`. A provider
 * without its credentials isn't offered.
 *
 * The `state` is signed (APP_SECRET) and carries the provider, the
 * workspace, the signed-in user, whether the connection is personal (a
 * host's own calendar), where to return, an expiry and a nonce that's
 * also an httpOnly cookie in the browser that started the flow. PKCE
 * (S256) is used where the provider supports it.
 */

export type OAuthProviderConfig = {
  provider: string;
  label: string;
  envPrefix: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce: boolean;
  /** Extra query parameters on the authorize URL. */
  extraParams?: Record<string, string>;
  /** How the token endpoint wants the client credentials. */
  clientAuth: "body" | "basic";
  /** Tokens don't expire (Notion, Mailchimp): no refresh. */
  longLived?: boolean;
};

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google_calendar: {
    provider: "google_calendar",
    label: "Google Calendar",
    envPrefix: "GOOGLE_OAUTH",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "email",
    ],
    pkce: true,
    extraParams: { access_type: "offline", prompt: "consent" },
    clientAuth: "body",
  },
  airtable: {
    provider: "airtable",
    label: "Airtable",
    envPrefix: "AIRTABLE",
    authorizeUrl: "https://airtable.com/oauth2/v1/authorize",
    tokenUrl: "https://airtable.com/oauth2/v1/token",
    scopes: ["data.records:write", "schema.bases:read"],
    pkce: true,
    clientAuth: "basic",
  },
  salesforce: {
    provider: "salesforce",
    label: "Salesforce",
    envPrefix: "SALESFORCE",
    authorizeUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    scopes: ["api", "refresh_token"],
    pkce: true,
    clientAuth: "body",
  },
  notion: {
    provider: "notion",
    label: "Notion",
    envPrefix: "NOTION",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    pkce: false,
    extraParams: { owner: "user" },
    clientAuth: "basic",
    longLived: true,
  },
  mailchimp: {
    provider: "mailchimp",
    label: "Mailchimp",
    envPrefix: "MAILCHIMP",
    authorizeUrl: "https://login.mailchimp.com/oauth2/authorize",
    tokenUrl: "https://login.mailchimp.com/oauth2/token",
    scopes: [],
    pkce: false,
    clientAuth: "body",
    longLived: true,
  },
  zoho_crm: {
    provider: "zoho_crm",
    label: "Zoho CRM",
    envPrefix: "ZOHO",
    authorizeUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    scopes: [
      "ZohoCRM.modules.leads.ALL",
      "ZohoCRM.modules.contacts.ALL",
      "ZohoCRM.settings.fields.READ",
    ],
    pkce: false,
    extraParams: { access_type: "offline", prompt: "consent" },
    clientAuth: "body",
  },
  pipedrive: {
    provider: "pipedrive",
    label: "Pipedrive",
    envPrefix: "PIPEDRIVE",
    authorizeUrl: "https://oauth.pipedrive.com/oauth/authorize",
    tokenUrl: "https://oauth.pipedrive.com/oauth/token",
    scopes: [],
    pkce: false,
    clientAuth: "basic",
  },
};

export function oauthProvider(provider: string): OAuthProviderConfig | null {
  return Object.hasOwn(OAUTH_PROVIDERS, provider) ? OAUTH_PROVIDERS[provider] : null;
}

function credentials(config: OAuthProviderConfig) {
  const clientId = process.env[`${config.envPrefix}_CLIENT_ID`];
  const clientSecret = process.env[`${config.envPrefix}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/connectors/oauth/callback`;
}

export function isConfigured(provider: string): boolean {
  const config = oauthProvider(provider);
  return Boolean(
    config &&
    credentials(config) &&
    process.env.APP_SECRET &&
    process.env.NEXT_PUBLIC_APP_URL,
  );
}

// --- state --------------------------------------------------------------

export const CONNECT_COOKIE = "fc_connect_nonce";
export const CONNECT_TTL_SECONDS = 10 * 60;

export type ConnectState = {
  provider: string;
  workspaceId: string;
  userId: string;
  personal: boolean;
  /** An app path to come back to (validated: starts with one "/"). */
  returnTo: string;
};

type Payload = {
  p: string;
  w: string;
  u: string;
  m: 0 | 1;
  r: string;
  n: string;
  e: number;
};

function secret(value = process.env.APP_SECRET): string {
  if (!value) throw new Error("APP_SECRET is not set");
  return value;
}

const sign = (body: string, key: string) =>
  createHmac("sha256", key).update(body).digest("base64url");

export function safeReturnPath(path: string | null | undefined): string {
  return path && /^\/(?!\/)[\w\-/.?=&%]*$/.test(path) ? path.slice(0, 300) : "/settings";
}

export function createConnectState(
  input: ConnectState,
  options: { secret?: string; now?: number } = {},
): { state: string; nonce: string } {
  const key = secret(options.secret);
  const nonce = randomBytes(16).toString("base64url");
  const payload: Payload = {
    p: input.provider,
    w: input.workspaceId,
    u: input.userId,
    m: input.personal ? 1 : 0,
    r: safeReturnPath(input.returnTo),
    n: nonce,
    e: Math.floor((options.now ?? Date.now()) / 1000) + CONNECT_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: `${body}.${sign(body, key)}`, nonce };
}

export function verifyConnectState(
  state: string | null | undefined,
  expected: { userId: string; cookieNonce: string | null | undefined },
  options: { secret?: string; now?: number } = {},
): { ok: true; value: ConnectState; nonce: string } | { ok: false; reason: string } {
  const key = secret(options.secret);
  const [body, signature, ...rest] = (state ?? "").split(".");
  if (!body || !signature || rest.length) return { ok: false, reason: "malformed" };
  const good = Buffer.from(sign(body, key));
  const given = Buffer.from(signature);
  if (good.length !== given.length || !timingSafeEqual(good, given)) {
    return { ok: false, reason: "bad_signature" };
  }
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.e < Math.floor((options.now ?? Date.now()) / 1000))
    return { ok: false, reason: "expired" };
  if (payload.u !== expected.userId) return { ok: false, reason: "wrong_user" };
  if (!expected.cookieNonce || expected.cookieNonce !== payload.n)
    return { ok: false, reason: "no_cookie" };
  return {
    ok: true,
    nonce: payload.n,
    value: {
      provider: payload.p,
      workspaceId: payload.w,
      userId: payload.u,
      personal: payload.m === 1,
      returnTo: safeReturnPath(payload.r),
    },
  };
}

/** A PKCE verifier only the browser that started the flow can produce. */
export function pkceFor(nonce: string, key = process.env.APP_SECRET) {
  const verifier = createHmac("sha256", secret(key))
    .update(`connect-pkce:${nonce}`)
    .digest("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

export function authorizeUrl(provider: string, state: string, nonce: string): string {
  const config = oauthProvider(provider);
  const creds = config && credentials(config);
  if (!config || !creds) throw new Error(`${provider} isn't configured`);
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  if (config.scopes.length) url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  for (const [k, v] of Object.entries(config.extraParams ?? {}))
    url.searchParams.set(k, v);
  if (config.pkce) {
    url.searchParams.set("code_challenge", pkceFor(nonce).challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

// --- tokens ---------------------------------------------------------------

export type Tokens = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms; absent for tokens that don't expire. */
  expiresAt?: number;
  /** Provider extras needed later: Salesforce instance_url, Mailchimp dc… */
  extra?: Record<string, string>;
};

type Fetcher = typeof fetch;

async function tokenRequest(
  config: OAuthProviderConfig,
  params: Record<string, string>,
  fetcher: Fetcher,
): Promise<Tokens> {
  const creds = credentials(config);
  if (!creds) throw new Error(`${config.provider} isn't configured`);
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (config.clientAuth === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", creds.clientId);
    body.set("client_secret", creds.clientSecret);
  }
  const res = await fetcher(config.tokenUrl, {
    method: "POST",
    headers,
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    throw new TokenError(String(data.error ?? `token endpoint ${res.status}`));
  }
  const extra: Record<string, string> = {};
  for (const key of [
    "instance_url",
    "api_domain",
    "workspace_id",
    "workspace_name",
    "bot_id",
  ]) {
    if (typeof data[key] === "string") extra[key] = data[key] as string;
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expiresAt:
      typeof data.expires_in === "number" && !config.longLived
        ? Date.now() + data.expires_in * 1000
        : undefined,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

export class TokenError extends Error {}

export async function exchangeCode(
  provider: string,
  code: string,
  nonce: string,
  fetcher: Fetcher = fetch,
): Promise<Tokens> {
  const config = oauthProvider(provider);
  if (!config) throw new TokenError("unknown provider");
  return tokenRequest(
    config,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      ...(config.pkce ? { code_verifier: pkceFor(nonce).verifier } : {}),
    },
    fetcher,
  );
}

/** Fresh tokens when they're within a minute of expiring; the same ones
 * otherwise. Keeps the refresh token when the provider doesn't rotate it. */
export async function refreshIfNeeded(
  provider: string,
  tokens: Tokens,
  fetcher: Fetcher = fetch,
  now = Date.now(),
): Promise<{ tokens: Tokens; refreshed: boolean }> {
  if (tokens.expiresAt === undefined || tokens.expiresAt - now > 60_000)
    return { tokens, refreshed: false };
  const config = oauthProvider(provider);
  if (!config || !tokens.refreshToken)
    throw new TokenError("expired and can't be refreshed");
  const next = await tokenRequest(
    config,
    { grant_type: "refresh_token", refresh_token: tokens.refreshToken },
    fetcher,
  );
  return {
    tokens: {
      ...next,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
      extra: { ...(tokens.extra ?? {}), ...(next.extra ?? {}) },
    },
    refreshed: true,
  };
}
