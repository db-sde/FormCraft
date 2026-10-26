function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// NEXT_PUBLIC_* values must be read with literal `process.env.NAME`
// expressions: Next.js inlines only those into browser bundles, so a
// dynamic `process.env[name]` lookup is always undefined client-side
// (which broke every browser Supabase client — the password reset
// page and the builder's image upload).
export const supabaseEnv = {
  get url() {
    return requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get anonKey() {
    return requireEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
  get serviceRoleKey() {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
};

/**
 * Options for Supabase's session cookies: SameSite=Lax (Supabase's
 * default), and Secure whenever the app is served over HTTPS, so the
 * session never travels over plain http. They can't be HttpOnly: the
 * browser client (password reset, two-factor setup, image uploads) reads
 * the session itself — the Content-Security-Policy is what keeps foreign
 * scripts away from it.
 */
export const sessionCookieOptions = {
  sameSite: "lax" as const,
  secure: process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://") ?? false,
};
