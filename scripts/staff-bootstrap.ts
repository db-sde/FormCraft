/**
 * Makes the first FormCraft staff owner (Super Admin Phase 0). Runs once:
 * the database refuses it as soon as any staff exist, after which people
 * are added in the portal through an approved request.
 *
 *   npm run staff:bootstrap -- <staff email> "<Name>"
 *
 * The account must already exist (sign up with a staff-only email) and
 * must not belong to any customer workspace. Needs the secret key, so it
 * runs from a trusted machine, never in the app. On first sign-in at
 * /admin the owner sets up an authenticator; nothing works without it.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();
  if (!email || !name) {
    console.error('Usage: npm run staff:bootstrap -- <staff email> "<Name>"');
    process.exit(1);
  }
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  let userId: string | null = null;
  for (let page = 1; page <= 50 && !userId; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId =
      data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    console.error(`No account for ${email}. Sign up with it first.`);
    process.exit(1);
  }
  const { error } = await admin.rpc("admin_bootstrap_owner", {
    p_user_id: userId,
    p_display_name: name.slice(0, 80),
  });
  if (error) {
    console.error(`Not done: ${error.message}`);
    process.exit(1);
  }
  console.log(`${email} is the first owner. Sign in at /admin on the admin deployment.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
