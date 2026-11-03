/**
 * The sites allowed to embed a form (hardening, 2026-11-03): one per
 * line or comma, as origins ("https://www.example.com"). A pasted page
 * URL is reduced to its origin. The database checks the same shape.
 */
export function parseEmbedOrigins(
  input: string,
): { ok: true; origins: string[] } | { ok: false; message: string } {
  const entries = input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return { ok: false, message: "Add at least one site, or allow any site." };
  }
  if (entries.length > 20) return { ok: false, message: "Up to 20 sites." };
  const origins: string[] = [];
  for (const entry of entries) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(entry) ? entry : `https://${entry}`);
    } catch {
      return { ok: false, message: `"${entry.slice(0, 60)}" isn't a website address.` };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, message: `"${entry.slice(0, 60)}" isn't a website address.` };
    }
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(url.hostname)) {
      return { ok: false, message: `"${entry.slice(0, 60)}" isn't a website address.` };
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return { ok: true, origins };
}
