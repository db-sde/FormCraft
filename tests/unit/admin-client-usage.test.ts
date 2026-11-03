import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_CLIENT_ALLOWED } from "./admin-client-allowlist";

/**
 * The service-role client bypasses row-level security, so every file
 * that uses it carries tenant isolation in its own code. These checks
 * keep that set from growing unnoticed and keep it out of the browser.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const users = files("src").filter((f) =>
  /from ["']@\/lib\/supabase\/admin["']/.test(readFileSync(f, "utf8")),
);

describe("service-role client use", () => {
  it("is limited to the reviewed allowlist", () => {
    const unexpected = users.filter((f) => !Object.hasOwn(ADMIN_CLIENT_ALLOWED, f));
    expect(
      unexpected,
      "New use of createAdminClient: prefer the user's client or a narrow database function; if it's needed, add the file to tests/unit/admin-client-allowlist.ts in review.",
    ).toEqual([]);
  });

  it("lists no file that no longer uses it (the list only shrinks)", () => {
    expect(Object.keys(ADMIN_CLIENT_ALLOWED).filter((f) => !users.includes(f))).toEqual(
      [],
    );
  });

  it("says why each file needs it", () => {
    for (const [file, why] of Object.entries(ADMIN_CLIENT_ALLOWED)) {
      expect(why.trim().length, file).toBeGreaterThan(10);
    }
  });

  it("never reaches browser code", () => {
    const client = users.filter((f) =>
      /^["']use client["']/.test(readFileSync(f, "utf8").trim()),
    );
    expect(client).toEqual([]);
    expect(readFileSync("src/lib/supabase/admin.ts", "utf8")).toMatch(
      /^import "server-only";/,
    );
  });
});
