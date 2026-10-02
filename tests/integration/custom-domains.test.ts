import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  addDomain,
  DomainError,
  provisionCertificate,
  recheckDomains,
  verifyDomain,
  type TxtResolver,
} from "@/domains/domains";

/**
 * Custom domains (migration 29) against the real database, with a fake
 * DNS resolver: plan limits, verification, losing verification when the
 * record goes, status that only the server can set, and the proxy's
 * lookup returning verified domains only.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const runId = crypto.randomUUID().slice(0, 8);
const password = `Pw-${crypto.randomUUID()}`;
const host = `forms-${runId}.example.com`;

let userId: string;
let user: SupabaseClient<Database>;
let workspaceId: string;
let formId: string;
let records: Record<string, string[][]> = {};
const resolver: TxtResolver = async (name) => {
  if (!records[name]) throw new Error("ENOTFOUND");
  return records[name];
};

beforeAll(async () => {
  const email = `domains-${runId}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
  user = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await user.auth.signInWithPassword({ email, password });
  const { data: ws } = await user.rpc("create_workspace_with_owner", {
    workspace_name: "Domains",
    workspace_slug: `domains-${runId}`,
  });
  workspaceId = ws!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Apply",
      slug: `apply-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("custom domains", () => {
  it("need a plan that includes them", async () => {
    await expect(addDomain(admin, workspaceId, host)).rejects.toBeInstanceOf(DomainError);
    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
  });

  it("are verified by their TXT record, and stop being served without it", async () => {
    const domain = await addDomain(admin, workspaceId, `https://${host.toUpperCase()}/`);
    expect(domain).toMatchObject({ hostname: host, status: "pending" });
    await expect(addDomain(admin, workspaceId, host)).rejects.toThrow(
      "already connected",
    );

    // No record yet: still pending, with a reason.
    let checked = await verifyDomain(admin, domain.id, resolver);
    expect(checked.status).toBe("pending");
    expect(checked.lastError).toContain("_formcraft-challenge");

    records[`_formcraft-challenge.${host}`] = [
      ["formcraft-verify=", domain.verificationToken],
    ];
    checked = await verifyDomain(admin, domain.id, resolver);
    expect(checked).toMatchObject({ status: "verified", lastError: null });

    const { data: lookup } = await user.rpc("resolve_custom_domain", {
      p_hostname: host,
    });
    expect(lookup).toEqual([{ domain_id: domain.id, default_slug: null }]);

    // The record is removed: the scheduled check takes the domain down.
    records = {};
    const summary = await recheckDomains(admin, resolver);
    expect(summary.failing).toBeGreaterThanOrEqual(1);
    const { data: after } = await user.rpc("resolve_custom_domain", { p_hostname: host });
    expect(after).toEqual([]);
  });

  it("only change status from a server check, and only open their own forms", async () => {
    const { data: domain } = await admin
      .from("custom_domains")
      .select("id")
      .eq("hostname", host)
      .single();
    await user
      .from("custom_domains")
      .update({ status: "verified", last_error: null })
      .eq("id", domain!.id);
    const { data: still } = await admin
      .from("custom_domains")
      .select("status")
      .eq("id", domain!.id)
      .single();
    expect(still?.status).toBe("error");

    const own = await user
      .from("custom_domains")
      .update({ default_form_id: formId })
      .eq("id", domain!.id)
      .select("default_form_id");
    expect(own.data?.[0]?.default_form_id).toBe(formId);

    const { data: otherWs } = await admin
      .from("workspaces")
      .insert({ name: "Other", slug: `domains-other-${runId}`, owner_id: userId })
      .select("id")
      .single();
    const { data: otherForm } = await admin
      .from("forms")
      .insert({
        workspace_id: otherWs!.id,
        title: "X",
        slug: `x-${runId}`,
        created_by: userId,
      })
      .select("id")
      .single();
    const foreign = await admin
      .from("custom_domains")
      .update({ default_form_id: otherForm!.id })
      .eq("id", domain!.id);
    expect(foreign.error?.message).toContain("another workspace");
    await admin.from("workspaces").delete().eq("id", otherWs!.id);
  });

  it("ask the host for a certificate when it's configured", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    process.env.VERCEL_API_TOKEN = "t";
    process.env.VERCEL_PROJECT_ID = "prj_1";
    try {
      expect(await provisionCertificate("forms.example.com", fakeFetch)).toEqual({
        ok: true,
      });
      expect(calls[0]).toBe("https://api.vercel.com/v10/projects/prj_1/domains");
    } finally {
      delete process.env.VERCEL_API_TOKEN;
      delete process.env.VERCEL_PROJECT_ID;
    }
    // Not configured: nothing to call, not an error.
    expect(await provisionCertificate("forms.example.com", fakeFetch)).toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(1);
  });
});
