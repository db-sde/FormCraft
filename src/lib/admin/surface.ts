/**
 * The Super Admin portal is compiled into every build. Where it's served
 * depends on ADMIN_SURFACE (docs/super-admin-design.md §3.1):
 *
 * - "1": the admin deployment (its own Vercel project) serves the portal
 *   and nothing else. The intended setup.
 * - "shared": the customer app also serves the portal at /admin on its
 *   own host (never on custom domains). A stopgap until the admin
 *   deployment exists (decided 28 Nov 2026, DECISIONS.md).
 * - unset (or anything else): /admin is a 404.
 *
 * Authorization never depends on this: every portal page and action
 * asks the database (private.check_staff).
 */
function mode(): "dedicated" | "shared" | "off" {
  const value = process.env.ADMIN_SURFACE;
  if (value === "1") return "dedicated";
  if (value === "shared") return "shared";
  return "off";
}

/** The portal is served by this deployment (dedicated or shared). */
export function adminSurfaceEnabled(): boolean {
  return mode() !== "off";
}

/** This deployment is the admin one, serving nothing but the portal. */
export function adminOnlySurface(): boolean {
  return mode() === "dedicated";
}

export function isAdminPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/");
}
