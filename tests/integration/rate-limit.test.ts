import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { hitRateLimit } from "@/domains/abuse";

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

describe("shared rate limit (Postgres)", () => {
  it("allows up to the limit per key, then refuses, independently per key", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const other = `test:${crypto.randomUUID()}`;
    const hit = (k: string) => hitRateLimit(admin, k, 2, 60_000).then((r) => r.allowed);

    expect(await hit(key)).toBe(true);
    expect(await hit(key)).toBe(true);
    expect(await hit(key)).toBe(false);
    expect(await hit(other)).toBe(true);

    await admin.from("rate_limits").delete().in("key", [key, other]);
  });

  it("isn't callable by anonymous clients", async () => {
    const anon = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { error } = await anon.rpc("hit_rate_limit", {
      p_key: "x",
      p_limit: 1,
      p_window_seconds: 1,
    });
    expect(error).not.toBeNull();
  });
});
