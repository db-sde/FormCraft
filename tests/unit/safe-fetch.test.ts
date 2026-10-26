import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { outboundUrlProblem, safeFetch } from "@/domains/webhooks/url-safety";

// Security checklist §1: server-side request forgery through webhook and
// lookup URLs.
let server: http.Server;
let port: number;
const seen: { method?: string; body: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, body });
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("which URLs may be called", () => {
  it("refuses other schemes", () => {
    for (const url of [
      "file:///etc/passwd",
      "gopher://example.com",
      "ftp://example.com",
    ]) {
      expect(outboundUrlProblem(url)).toMatch(/http and https/);
    }
  });

  it("refuses private, loopback and metadata addresses, however they're written", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const url of [
      "http://127.0.0.1",
      "http://localhost/",
      "http://[::1]/",
      "http://10.0.0.1",
      "http://172.16.0.1",
      "http://192.168.1.1",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal",
      "http://2130706433", // 127.0.0.1 as a number
      "http://0x7f000001", // …in hex
      "http://0177.0.0.1", // …in octal
      "http://[::ffff:169.254.169.254]/",
    ]) {
      expect(outboundUrlProblem(url), url).toBe("endpoint host not allowed");
    }
  });

  it("only uses the standard web ports in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const port of [22, 6379, 5432]) {
      expect(outboundUrlProblem(`https://example.com:${port}/`)).toMatch(
        /standard ports/,
      );
    }
    expect(outboundUrlProblem("https://example.com/hook")).toBeNull();
    expect(outboundUrlProblem("http://example.com:80/hook")).toBeNull();
  });
});

describe("safeFetch", () => {
  it("delivers to an allowed address", async () => {
    const res = await safeFetch(`http://127.0.0.1:${port}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(seen.at(-1)).toEqual({ method: "POST", body: '{"a":1}' });
  });

  it("never follows a redirect (to the metadata address or anywhere)", async () => {
    const res = await safeFetch(`http://127.0.0.1:${port}/redirect`);
    expect(res.status).toBe(302);
    await expect(
      safeFetch(`http://127.0.0.1:${port}/redirect`, { redirect: "error" }),
    ).rejects.toThrow(/redirect/);
  });

  it("checks the address it actually connects to (DNS rebinding)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // A public-looking name that, by the time the request connects,
    // resolves to the cloud metadata address.
    vi.spyOn(dns, "lookup").mockImplementation(((
      _host: string,
      _opts: unknown,
      cb: (e: null, a: { address: string; family: number }[]) => void,
    ) => cb(null, [{ address: "169.254.169.254", family: 4 }])) as never);
    const before = seen.length;
    await expect(safeFetch("http://rebind.example/latest/meta-data/")).rejects.toThrow(
      /not allowed/,
    );
    expect(seen.length).toBe(before);
  });

  it("refuses before connecting when the URL itself isn't allowed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(safeFetch(`http://127.0.0.1:${port}/hook`)).rejects.toThrow();
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(/http and https/);
  });
});
