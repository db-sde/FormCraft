// A stand-in for Sentry's ingest API, for the staff portal's "Send test
// error" end-to-end check. Point a build at it with
//   NEXT_PUBLIC_SENTRY_DSN=http://e2e@127.0.0.1:4606/1
// and it records the event id of every envelope it receives, listed at
// GET /events. Nothing else is kept.
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_SENTRY_PORT ?? 4606);
const ids = [];

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ids }));
    return;
  }
  if (req.method === "POST" && /^\/api\/\d+\/envelope\/?/.test(req.url ?? "")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        // An envelope's first line is its header, carrying the event id.
        const header = JSON.parse(body.split("\n", 1)[0]);
        if (header.event_id) ids.push(header.event_id);
      } catch {
        // Not an event (e.g. a client report): ignore.
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, "127.0.0.1");
