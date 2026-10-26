import { lookup } from "node:dns/promises";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

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
 *    to, so e.g. `127.0.0.1.nip.io` is rejected when the URL is saved.
 * 3. safeFetch — every outbound request checks the address it is about
 *    to connect to, inside the connection itself, so a DNS record that
 *    changes after the earlier checks (rebinding) still can't reach an
 *    internal address. It never follows redirects (a public URL can't
 *    bounce the request inward) and, in production, only uses the
 *    standard web ports.
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

/** Production requests use the standard web ports only (not 22, 6379,
 * 5432…), so a public host can't be used to probe other services. */
const WEB_PORTS = new Set(["", "80", "443"]);

/** Why an outbound URL may not be called, or null if it may. Checks the
 * URL itself; the address is checked again at connection time. */
export function outboundUrlProblem(raw: string | URL): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "only http and https URLs are allowed";
  }
  if (!loopbackAllowed() && !WEB_PORTS.has(url.port)) {
    return "only the standard ports (80, 443) are allowed";
  }
  if (isDisallowedWebhookHost(url.hostname)) return "endpoint host not allowed";
  return null;
}

class BlockedAddressError extends Error {
  code = "EHOSTBLOCKED";
  constructor() {
    super("endpoint host not allowed");
  }
}

/** A DNS lookup for outbound sockets that refuses (at connect time) any
 * address an outbound request must not reach. */
function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (...args: unknown[]) => void,
): void {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = addresses as unknown as dns.LookupAddress[];
    const blocked = list.some(({ address }) => {
      const verdict = classifyAddress(address);
      return verdict !== null && isDisallowedVerdict(verdict);
    });
    if (blocked || list.length === 0) return callback(new BlockedAddressError());
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/**
 * `fetch` for creator-chosen URLs (webhooks, data lookups): the address
 * actually connected to is checked (see guardedLookup), redirects are
 * returned rather than followed (`redirect: "error"` makes them throw,
 * like fetch), and only http(s) on allowed ports is called. Bodies are
 * strings; the response body streams, so callers can cap what they read.
 */
export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const problem = outboundUrlProblem(input);
  if (problem) throw new TypeError(problem);
  const url = new URL(input);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const body = typeof init.body === "string" ? init.body : undefined;
  if (body !== undefined && !("content-length" in headers)) {
    headers["content-length"] = String(Buffer.byteLength(body));
  }
  const transport = url.protocol === "https:" ? https : http;

  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: init.method ?? "GET",
        headers,
        // A fresh connection per request, resolved through the guard.
        agent: false,
        lookup: guardedLookup as never,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && init.redirect === "error") {
          res.destroy();
          reject(new TypeError(`redirect (${status}) not followed`));
          return;
        }
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          for (const v of Array.isArray(value) ? value : [value]) {
            responseHeaders.append(name, v);
          }
        }
        const noBody = status === 204 || status === 304 || init.method === "HEAD";
        if (noBody) res.resume();
        resolve(
          new Response(
            noBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>),
            { status, headers: responseHeaders },
          ),
        );
      },
    );
    const abort = () => request.destroy(init.signal?.reason ?? new Error("aborted"));
    if (init.signal?.aborted) abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    request.on("error", reject);
    request.end(body);
  });
}
