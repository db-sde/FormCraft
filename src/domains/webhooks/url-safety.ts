import { lookup } from "node:dns/promises";

/**
 * SSRF defenses for creator-configured webhook URLs. Webhooks make the
 * server send requests to an address a creator chose, so that address
 * must never be one only the server can reach: loopback, private
 * networks, link-local (which includes the 169.254.169.254 cloud
 * metadata endpoint), or other reserved ranges.
 *
 * Three layers, all applied both when an endpoint is added and before
 * every delivery:
 * 1. isDisallowedWebhookHost — the literal hostname / IP in the URL,
 *    including IPv6 (bracketed in URL.hostname) and IPv4-mapped IPv6.
 * 2. resolvesToDisallowedAddress — the addresses a hostname resolves
 *    to, so e.g. `127.0.0.1.nip.io` is rejected too. (A DNS record can
 *    still change between this check and the connection — rebinding —
 *    which needs connection-level pinning; out of scope for Phase 1.)
 * 3. Deliveries never follow redirects (see deliverOnce), so a public
 *    URL can't bounce the request to an internal one.
 *
 * Loopback is allowed outside production only, because local
 * development needs to point webhooks at a local receiver.
 */

function loopbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Parses a dotted-quad IPv4 address; null if it isn't one. */
function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

function isLoopbackIpv4([a]: number[]): boolean {
  return a === 127;
}

function isReservedIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

/** Expands an IPv6 address to 8 hextets; null if it isn't one. */
function parseIpv6(address: string): number[] | null {
  let text = address;
  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two hextets.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = parseIpv4(dotted[2]);
    if (!v4) return null;
    text = `${dotted[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...Array(halves.length === 2 ? missing : 0).fill("0"),
    ...tail,
  ];
  const hextets = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return hextets.every((h) => !Number.isNaN(h)) ? hextets : null;
}

type AddressVerdict = "public" | "loopback" | "reserved";

/** Classifies a literal IPv4/IPv6 address (IPv6 with or without
 * brackets). Returns null for anything that isn't an IP literal. */
function classifyAddress(address: string): AddressVerdict | null {
  const v4 = parseIpv4(address);
  if (v4) {
    if (isLoopbackIpv4(v4)) return "loopback";
    return isReservedIpv4(v4) ? "reserved" : "public";
  }

  const v6 = parseIpv6(address.replace(/^\[|\]$/g, ""));
  if (!v6) return null;
  const isZeroPrefix = (n: number) => v6.slice(0, n).every((h) => h === 0);

  if (isZeroPrefix(7) && v6[7] === 1) return "loopback"; // ::1
  if (isZeroPrefix(8)) return "reserved"; // ::
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) embed an
  // IPv4 address — judge that address instead.
  const embedsV4 =
    (isZeroPrefix(5) && v6[5] === 0xffff) ||
    (v6[0] === 0x64 && v6[1] === 0xff9b && v6.slice(2, 6).every((h) => h === 0));
  if (embedsV4) {
    const embedded = [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff];
    if (isLoopbackIpv4(embedded)) return "loopback";
    return isReservedIpv4(embedded) ? "reserved" : "public";
  }
  if ((v6[0] & 0xfe00) === 0xfc00) return "reserved"; // unique local fc00::/7
  if ((v6[0] & 0xffc0) === 0xfe80) return "reserved"; // link-local fe80::/10
  if ((v6[0] & 0xff00) === 0xff00) return "reserved"; // multicast
  return "public";
}

function isDisallowedVerdict(verdict: AddressVerdict): boolean {
  return verdict === "reserved" || (verdict === "loopback" && !loopbackAllowed());
}

/** Layer 1: the literal hostname from `new URL(...).hostname`. */
export function isDisallowedWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");

  if (host === "localhost" || host.endsWith(".localhost")) {
    return !loopbackAllowed();
  }
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;

  const verdict = classifyAddress(host);
  return verdict !== null && isDisallowedVerdict(verdict);
}

/** Layer 2: every address the hostname currently resolves to. A name
 * that doesn't resolve is left for the delivery attempt to fail on. */
export async function resolvesToDisallowedAddress(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (classifyAddress(host) !== null) return isDisallowedWebhookHost(hostname);

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return false;
  }
  return addresses.some(({ address }) => {
    const verdict = classifyAddress(address);
    return verdict !== null && isDisallowedVerdict(verdict);
  });
}
