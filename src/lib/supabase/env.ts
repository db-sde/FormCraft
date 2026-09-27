function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const supabaseEnv = {
  get url() {
    return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  },
  get anonKey() {
    return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get serviceRoleKey() {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
};
