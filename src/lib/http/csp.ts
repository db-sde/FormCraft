/**
 * The Content-Security-Policy for every page, built per request with a
 * fresh nonce (see src/proxy.ts). Scripts run only if they carry the
 * nonce — Next.js adds it to its own — or were loaded by one that did
 * ('strict-dynamic', for tag managers). Everything else is limited to
 * this site plus the few services the app really talks to.
 *
 * Styles allow 'unsafe-inline': React writes `style` attributes (theme
 * colours, progress bars), which a nonce can't cover. Injected styles
 * can't run code, and scripts are what this policy is for.
 */

const PIXEL_SCRIPT_HOSTS = [
  "https://www.googletagmanager.com",
  "https://connect.facebook.net",
];
const PIXEL_CONNECT_HOSTS = [
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://www.googletagmanager.com",
  "https://www.facebook.com",
];
const PIXEL_IMG_HOSTS = [
  "https://www.google-analytics.com",
  "https://www.googletagmanager.com",
  "https://www.facebook.com",
];
/** Booking pages shown on endings (scheduler.ts allows only these). */
const SCHEDULER_FRAMES = [
  "https://calendly.com",
  "https://www.calendly.com",
  "https://cal.com",
  "https://app.cal.com",
];

export type CspOptions = {
  nonce: string;
  /** The Supabase project (storage images and fonts, browser auth calls). */
  supabaseUrl: string;
  /** A published form: may be framed by any site, and may run the
   * creator's analytics pixels (P2.12). */
  publicForm: boolean;
  /** Development needs eval for React's tooling and plain-http reloads. */
  dev?: boolean;
  /** Served over HTTPS: any stray http:// subresource is upgraded.
   * (Never over plain http, where the upgrade would break every asset.) */
  https?: boolean;
};

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp({
  nonce,
  supabaseUrl,
  publicForm,
  dev = false,
  https = true,
}: CspOptions) {
  const supabase = origin(supabaseUrl);
  const supabaseHosts = supabase
    ? [supabase, supabase.replace(/^http/, "ws")] // realtime/auth sockets
    : [];
  const pixels = publicForm;

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(pixels ? PIXEL_SCRIPT_HOSTS : []),
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      ...(supabase ? [supabase] : []),
      ...(pixels ? PIXEL_IMG_HOSTS : []),
    ],
    "font-src": ["'self'", "data:", ...(supabase ? [supabase] : [])],
    "connect-src": [
      "'self'",
      ...supabaseHosts,
      ...(pixels ? PIXEL_CONNECT_HOSTS : []),
      ...(dev ? ["ws:"] : []),
    ],
    "media-src": ["'self'", ...(supabase ? [supabase] : [])],
    "frame-src": ["'self'", ...SCHEDULER_FRAMES],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // Published forms are made to be embedded (Share → Embed); nothing
    // else may be framed (clickjacking).
    "frame-ancestors": publicForm ? ["*"] : ["'none'"],
  };

  const policy = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );
  if (https && !dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** A random nonce for one response. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** API responses are data, never pages: they load and frame nothing. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
