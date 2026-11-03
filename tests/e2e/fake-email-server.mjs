// A stand-in for Resend's API during end-to-end runs (playwright.config.ts
// points RESEND_BASE_URL here), so email features are switched on and
// exercised without any message leaving the machine. GET /sent lists what
// was "sent" (newest last) for specs that check an email went out.
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_EMAIL_PORT ?? 4604);
const sent = [];

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (req.method === "POST" && path === "/emails") {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        res.statusCode = 422;
        return res.end(JSON.stringify({ message: "bad json" }));
      }
      const id = `fake_${sent.length + 1}`;
      sent.push({
        id,
        to: body.to,
        subject: body.subject,
        attachments: (body.attachments ?? []).map((a) => a.filename),
      });
      if (sent.length > 2000) sent.splice(0, 1000);
      return res.end(JSON.stringify({ id }));
    }
    if (req.method === "GET" && path === "/sent") return res.end(JSON.stringify(sent));
    if (req.method === "GET" && path === "/") return res.end("{}");
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "not found" }));
  });
}).listen(PORT, "127.0.0.1");
