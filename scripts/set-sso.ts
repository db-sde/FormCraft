/**
 * Connects a workspace to a SAML identity provider (PRD P3.12).
 *
 * 1. Register the provider with Supabase Auth (needs the Pro plan):
 *      supabase sso add --type saml --project-ref <ref> \
 *        --metadata-url https://idp.example.com/metadata --domains example.com
 *    It prints the provider's id.
 * 2. Map it to the workspace:
 *      npm run sso:set -- <workspace id or slug> <domain> <provider id>
 *    or disconnect:
 *      npm run sso:set -- <workspace id or slug> --remove
 *
 * Done with the service role on purpose: a workspace admin can't point
 * someone else's provider at their own workspace.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

async function main() {
  const [target, domainArg, providerId] = process.argv.slice(2);
  if (!target || !domainArg || (domainArg !== "--remove" && !providerId)) {
    console.error(
      "Usage: npm run sso:set -- <workspace id or slug> <domain> <provider id>\n" +
        "       npm run sso:set -- <workspace id or slug> --remove",
    );
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
    );
  const admin = createClient<Database>(url, key, { auth: { persistSession: false } });

  const isId = /^[0-9a-f-]{36}$/i.test(target);
  const { data: workspace } = await admin
    .from("workspaces")
    .select("id, name")
    .eq(isId ? "id" : "slug", target)
    .maybeSingle();
  if (!workspace) throw new Error(`No workspace "${target}".`);

  if (domainArg === "--remove") {
    await admin.from("workspace_sso").delete().eq("workspace_id", workspace.id);
    await admin.from("audit_logs").insert({
      workspace_id: workspace.id,
      action: "security.sso_changed",
      metadata: { connected: false },
    });
    console.log(`Disconnected single sign-on from ${workspace.name}.`);
    return;
  }

  const domain = domainArg.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(providerId))
    throw new Error("The provider id is the UUID printed by `supabase sso add`.");
  const { error } = await admin.from("workspace_sso").upsert({
    workspace_id: workspace.id,
    domain,
    provider_id: providerId,
  });
  if (error) throw new Error(error.message);
  await admin.from("audit_logs").insert({
    workspace_id: workspace.id,
    action: "security.sso_changed",
    metadata: { connected: true, domain },
  });
  console.log(
    `${workspace.name} now uses single sign-on for ${domain}. ` +
      "Its plan must include SSO (npm run plan:set), and an admin can require it in Settings → Security.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
