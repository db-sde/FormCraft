import { adminClient } from "./helpers";

/** Rate limits are shared and persistent (Postgres), so repeated local
 * runs from the same IP would eventually trip signup/reset limits —
 * start every run with a clean slate. Never touches production. */
export default async function globalSetup() {
  await adminClient().from("rate_limits").delete().neq("key", "");
}
