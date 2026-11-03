import net from "node:net";

/**
 * Malware scanning for respondent uploads (hardening, 2026-11-03), with a
 * ClamAV daemon (clamd) over its standard INSTREAM protocol: the bytes go
 * in length-prefixed chunks, clamd answers "stream: OK" or
 * "stream: <signature> FOUND". Configure CLAMD_HOST (and CLAMD_PORT,
 * default 3310) to turn it on; uploads are then scanned before they're
 * stored. A configured scanner that can't be reached refuses the upload
 * (fail closed) rather than letting an unchecked file through.
 * Without CLAMD_HOST nothing is scanned (the previous behaviour).
 */

export type ScanResult =
  | { status: "clean" }
  | { status: "infected"; signature: string }
  | { status: "unavailable"; reason: string }
  | { status: "skipped" };

export function scannerConfigured(): boolean {
  return Boolean(process.env.CLAMD_HOST);
}

const CHUNK = 64 * 1024;

/** Parses clamd's reply to INSTREAM. */
export function parseClamdReply(reply: string): ScanResult {
  const text = reply.replace(/\0/g, "").trim();
  if (/^stream: OK$/.test(text)) return { status: "clean" };
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found) return { status: "infected", signature: found[1].slice(0, 200) };
  return { status: "unavailable", reason: text.slice(0, 200) || "empty reply" };
}

export function scanBytes(
  bytes: Uint8Array,
  options: { host?: string; port?: number; timeoutMs?: number } = {},
): Promise<ScanResult> {
  const host = options.host ?? process.env.CLAMD_HOST;
  if (!host) return Promise.resolve({ status: "skipped" });
  const port = options.port ?? Number(process.env.CLAMD_PORT ?? 3310);
  return new Promise((resolve) => {
    let reply = "";
    let settled = false;
    const done = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const socket = net.createConnection({ host, port });
    socket.setTimeout(options.timeoutMs ?? 20_000, () =>
      done({ status: "unavailable", reason: "scanner timed out" }),
    );
    socket.on("error", (error) => done({ status: "unavailable", reason: error.message }));
    socket.on("data", (data) => {
      reply += data.toString("utf8");
      if (reply.includes("\0") || reply.endsWith("\n")) done(parseClamdReply(reply));
    });
    socket.on("end", () => done(parseClamdReply(reply)));
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < bytes.byteLength; i += CHUNK) {
        const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength));
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.byteLength);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4)); // zero length: end of stream
    });
  });
}
