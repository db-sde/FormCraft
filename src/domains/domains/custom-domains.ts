import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspacePlan, withinLimit } from "@/domains/billing/entitlements";

type Client = SupabaseClient<Database>;

/**
 * Custom domains (PRD P2.2). A creator adds `forms.example.com`, points
 * it at FormCraft (CNAME) and proves they own it (TXT record with a
 * token). Only verified domains are routed (src/proxy.ts); the
 * scheduled re-check turns a domain whose record vanished to "error",
 * which stops routing until it's fixed. TLS certificates are issued by
 * the hosting platform: `provisionCertificate` calls its API when
 * configured (Vercel: VERCEL_API_TOKEN + VERCEL_PROJECT_ID), otherwise
 * the host must be set up to serve the domain.
 */

export type DomainStatus = "pending" | "verified" | "error";

export type CustomDomain = {
  id: string;
  hostname: string;
  status: DomainStatus;
  verificationToken: string;
  defaultFormId: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

const HOSTNAME = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** The app's own host(s): never a customer's domain. */
function appHosts(): string[] {
  const hosts = ["localhost"];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      hosts.push(new URL(appUrl).hostname);
    } catch {
      // ignore a malformed setting
    }
  }
  return hosts;
}

/** "https://Forms.Example.com/x" → "forms.example.com", or an error. */
export function normalizeHostname(input: string): string {
  let host = input.trim().toLowerCase();
  host = host
    .replace(/^[a-z]+:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "");
  host = host.replace(/\.$/, "");
  if (!HOSTNAME.test(host) || host.length > 253) {
    throw new DomainError("Enter a domain like forms.example.com.");
  }
  if (/^\d+(\.\d+){3}$/.test(host))
    throw new DomainError("Use a domain name, not an IP address.");
  if (
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new DomainError("That domain can't be reached from the internet.");
  }
  if (appHosts().some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new DomainError("That's FormCraft's own domain.");
  }
  return host;
}

/** The DNS records the creator adds. */
export function dnsInstructions(
  domain: Pick<CustomDomain, "hostname" | "verificationToken">,
) {
  const target =
    process.env.CUSTOM_DOMAIN_CNAME_TARGET ??
    (process.env.NEXT_PUBLIC_APP_URL
      ? new URL(process.env.NEXT_PUBLIC_APP_URL).hostname
      : "");
  return {
    cname: { name: domain.hostname, value: target },
    txt: {
      name: `_formcraft-challenge.${domain.hostname}`,
      value: `formcraft-verify=${domain.verificationToken}`,
    },
  };
}

function fromRow(
  row: Database["public"]["Tables"]["custom_domains"]["Row"],
): CustomDomain {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status as DomainStatus,
    verificationToken: row.verification_token,
    defaultFormId: row.default_form_id,
    verifiedAt: row.verified_at,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
  };
}

export async function listDomains(
  supabase: Client,
  workspaceId: string,
): Promise<CustomDomain[]> {
  const { data, error } = await supabase
    .from("custom_domains")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

/** Adds a domain (pending). The caller has checked the user is an admin;
 * the plan's limit is checked here. Service-role client. */
export async function addDomain(
  admin: Client,
  workspaceId: string,
  input: string,
): Promise<CustomDomain> {
  const hostname = normalizeHostname(input);
  const { entitlements } = await getWorkspacePlan(admin, workspaceId);
  const { count } = await admin
    .from("custom_domains")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (!withinLimit(entitlements, "custom_domains", count ?? 0)) {
    throw new DomainError(
      entitlements.custom_domains === 0
        ? "Custom domains are part of the Business plan."
        : `Your plan includes ${entitlements.custom_domains} custom domain${entitlements.custom_domains === 1 ? "" : "s"}.`,
    );
  }
  const { data, error } = await admin
    .from("custom_domains")
    .insert({
      workspace_id: workspaceId,
      hostname,
      verification_token: randomBytes(16).toString("hex"),
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505")
      throw new DomainError("That domain is already connected.");
    throw error;
  }
  return fromRow(data);
}

export type TxtResolver = (name: string) => Promise<string[][]>;

/** Looks up the TXT record and records the result. Service role. */
export async function verifyDomain(
  admin: Client,
  domainId: string,
  resolver: TxtResolver = resolveTxt,
  now = new Date(),
): Promise<CustomDomain> {
  const { data: row, error } = await admin
    .from("custom_domains")
    .select("*")
    .eq("id", domainId)
    .single();
  if (error) throw error;
  const domain = fromRow(row);
  const expected = dnsInstructions(domain).txt;

  let found = false;
  let problem: string | null = null;
  try {
    const records = await resolver(expected.name);
    found = records.some((chunks) => chunks.join("") === expected.value);
    if (!found)
      problem = `The TXT record ${expected.name} doesn't contain the verification value yet.`;
  } catch {
    problem = `No TXT record found at ${expected.name} yet. DNS changes can take a while to appear.`;
  }

  let status: DomainStatus = found
    ? "verified"
    : domain.status === "pending"
      ? "pending"
      : "error";
  if (found && domain.status !== "verified") {
    const tls = await provisionCertificate(domain.hostname);
    if (!tls.ok) {
      status = "error";
      problem = tls.message;
    }
  }
  const { data: updated, error: updateError } = await admin
    .from("custom_domains")
    .update({
      status,
      last_checked_at: now.toISOString(),
      last_error: status === "verified" ? null : problem,
      verified_at:
        status === "verified"
          ? (domain.verifiedAt ?? now.toISOString())
          : domain.verifiedAt,
    })
    .eq("id", domainId)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return fromRow(updated);
}

/** Scheduled: re-check every connected domain so one whose DNS was
 * removed stops being served (and pending ones get picked up). */
export async function recheckDomains(
  admin: Client,
  resolver: TxtResolver = resolveTxt,
): Promise<{ checked: number; verified: number; failing: number }> {
  const { data, error } = await admin.from("custom_domains").select("id").limit(1000);
  if (error) throw error;
  let verified = 0;
  let failing = 0;
  for (const { id } of data ?? []) {
    const result = await verifyDomain(admin, id, resolver);
    if (result.status === "verified") verified += 1;
    if (result.status === "error") failing += 1;
  }
  return { checked: data?.length ?? 0, verified, failing };
}

/**
 * Asks the hosting platform to serve the domain (and issue its TLS
 * certificate). Vercel when configured; otherwise nothing to call —
 * the domain must be added to the host by hand.
 */
export async function provisionCertificate(
  hostname: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = process.env.VERCEL_API_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID;
  if (!token || !project) return { ok: true };
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  try {
    const res = await fetchImpl(
      `https://api.vercel.com/v10/projects/${project}/domains${team}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: hostname }),
      },
    );
    // 409: already added to the project, which is what we want.
    if (res.ok || res.status === 409) return { ok: true };
    return {
      ok: false,
      message: "The certificate couldn't be set up yet. We'll try again.",
    };
  } catch {
    return {
      ok: false,
      message: "The certificate couldn't be set up yet. We'll try again.",
    };
  }
}
