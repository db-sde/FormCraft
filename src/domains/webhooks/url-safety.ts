/**
 * A first line of defense against SSRF via a creator-configured
 * webhook URL: reject hostnames that are obviously loopback, private,
 * or link-local (which includes the 169.254.169.254 cloud metadata
 * address many SSRF exploits target) before ever accepting the URL or
 * attempting a delivery to it. This is a pattern check on the literal
 * hostname/IP in the URL, not DNS-resolution-time protection (a
 * hostname could still resolve to an internal address at request
 * time, e.g. DNS rebinding) — real protection against that needs
 * resolving the hostname and checking the actual IP immediately before
 * each connection, which is future hardening, not this check's job.
 * `localhost`/loopback is allowed only because local development
 * needs it; production webhook URLs still require HTTPS regardless.
 */
export function isDisallowedWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return false; // allowed — see module doc
  }

  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === "0.0.0.0") return true;
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;

  return false;
}
