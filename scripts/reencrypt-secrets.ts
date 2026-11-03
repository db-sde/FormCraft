/**
 * Rewrites every stored secret under the current encryption key
 * (ENCRYPTION_KEYS' first key, or the APP_SECRET-derived default), bound
 * to its row. Run after adding a new key, before removing an old one:
 *
 *   npm run secrets:reencrypt -- --dry-run   # count only
 *   npm run secrets:reencrypt
 *
 * Reads .env.local (or the environment) for Supabase and the keys.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { reencryptSecrets } from "../src/lib/crypto/reencrypt";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient<Database>(url, key, { auth: { persistSession: false } });
  const dryRun = process.argv.includes("--dry-run");
  const report = await reencryptSecrets(admin, { dryRun });
  console.table(report);
  if (report.some((r) => r.failed > 0)) {
    console.error("Some values couldn't be decrypted with any configured key.");
    process.exitCode = 1;
  }
}

void main();
