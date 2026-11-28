import { describe, expect, it } from "vitest";
import { PERMISSION_LABELS } from "@/lib/admin/permission-labels";
import { canRunLocally, sql } from "./staff-helpers";

const describeLocal = canRunLocally ? describe : describe.skip;

/** Every permission a staff role can hold has a plain name on the portal
 * home page, and no name is left for a permission that's gone. */
describeLocal("staff permission labels", () => {
  it("match the permissions in private.role_permissions", () => {
    const definition = sql(
      "select pg_get_functiondef('private.role_permissions(text)'::regprocedure);",
    );
    const inDatabase = new Set(
      definition.match(/'[a-z_]+\.[a-z_]+'/g)!.map((q) => q.slice(1, -1)),
    );
    expect(inDatabase.size).toBeGreaterThan(10);
    expect([...inDatabase].sort()).toEqual(Object.keys(PERMISSION_LABELS).sort());
  });
});
