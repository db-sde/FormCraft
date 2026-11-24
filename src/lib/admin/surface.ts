/**
 * The Super Admin portal is compiled into every build but served only by
 * the admin deployment, which sets ADMIN_SURFACE=1 (its own Vercel
 * project, docs/super-admin-design.md §3.1). Everywhere else /admin is a
 * 404, and the admin deployment serves nothing but the portal.
 */
export function adminSurfaceEnabled(): boolean {
  return process.env.ADMIN_SURFACE === "1";
}

export function isAdminPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/");
}
