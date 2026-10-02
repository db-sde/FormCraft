/** Set only by src/proxy.ts, for a request that came in on a verified
 * custom domain (P2.2); the public form page checks the form belongs to
 * that domain's workspace. Any incoming copy is stripped by the proxy. */
export const CUSTOM_DOMAIN_HEADER = "x-fc-domain";
