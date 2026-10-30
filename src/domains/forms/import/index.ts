import "server-only";
import { safeFetch } from "@/domains/webhooks/url-safety";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { buildImportedSchema, type ImportReport, type ImportSource } from "./build";
import { extractGoogleData, isGoogleSignIn, parseGoogleForm } from "./google";
import { extractTypeformJson, findTypeformDefinition, parseTypeform } from "./typeform";

export * from "./build";

/**
 * Fetches a public form and turns it into a draft (F-05). Only these
 * hosts are fetched, through the same guarded fetch webhooks use (the
 * address connected to is checked; redirects aren't followed blindly),
 * with a size cap and a timeout. No account connection, no cookies.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export type ImportTarget =
  | { kind: "google_forms"; url: string }
  | { kind: "google_short"; url: string }
  | { kind: "typeform"; url: string; id: string };

const UNSUPPORTED =
  "Paste a public Google Forms link (docs.google.com/forms/… or forms.gle/…) or a Typeform link (….typeform.com/to/…).";

/** What a pasted link points at, or a message saying what to paste. */
export function importTarget(raw: string): ImportTarget | { error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: UNSUPPORTED };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { error: UNSUPPORTED };
  const host = url.hostname.toLowerCase();
  if (host === "docs.google.com") {
    const published = /^\/forms\/d\/e\/([A-Za-z0-9_-]+)/.exec(url.pathname);
    if (published) {
      return {
        kind: "google_forms",
        url: `https://docs.google.com/forms/d/e/${published[1]}/viewform`,
      };
    }
    const byId = /^\/forms\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname);
    if (byId) {
      return {
        kind: "google_forms",
        url: `https://docs.google.com/forms/d/${byId[1]}/viewform`,
      };
    }
    return { error: UNSUPPORTED };
  }
  if (host === "forms.gle" && /^\/[A-Za-z0-9]+$/.test(url.pathname)) {
    return { kind: "google_short", url: `https://forms.gle${url.pathname}` };
  }
  if (host === "typeform.com" || host.endsWith(".typeform.com")) {
    const m = /^\/to\/([A-Za-z0-9]+)/.exec(url.pathname);
    if (m)
      return { kind: "typeform", url: `https://form.typeform.com/to/${m[1]}`, id: m[1] };
  }
  return { error: UNSUPPORTED };
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new ImportError("That page is too large to import.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type Fetcher = (url: string) => Promise<Response>;

const defaultFetch: Fetcher = (url) =>
  safeFetch(url, {
    headers: {
      accept: "text/html,application/json",
      "accept-language": "en",
      "user-agent": "FormCraft-Importer/1.0 (+form import from a public link)",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

async function get(
  url: string,
  fetcher: Fetcher,
): Promise<{ status: number; location: string | null; body: string }> {
  let res: Response;
  try {
    res = await fetcher(url);
  } catch {
    throw new ImportError("The form couldn't be reached. Check the link and try again.");
  }
  if (res.status >= 300 && res.status < 400) {
    return { status: res.status, location: res.headers.get("location"), body: "" };
  }
  return { status: res.status, location: null, body: await readCapped(res) };
}

const PRIVATE_GOOGLE =
  "This Google Form isn't public: it asks people to sign in. In Google Forms, open Settings → Responses, turn off “Restrict to users in …”, and try again.";

async function loadGoogle(url: string, fetcher: Fetcher) {
  let page = await get(url, fetcher);
  // Google sometimes adds one redirect (to add a query string).
  if (page.location) {
    const next = new URL(page.location, url);
    if (next.hostname === "accounts.google.com") throw new ImportError(PRIVATE_GOOGLE);
    if (next.hostname !== "docs.google.com") throw new ImportError(PRIVATE_GOOGLE);
    page = await get(next.toString(), fetcher);
    if (page.location) throw new ImportError(PRIVATE_GOOGLE);
  }
  if (page.status === 404) throw new ImportError("There's no Google Form at that link.");
  if (page.status !== 200)
    throw new ImportError("Google didn't share that form. Try again later.");
  if (isGoogleSignIn(page.body)) throw new ImportError(PRIVATE_GOOGLE);
  const data = extractGoogleData(page.body);
  if (!data) {
    throw new ImportError(
      "That page doesn't look like a Google Form that's open for responses. Check it's the form's public link and that it's accepting responses.",
    );
  }
  return parseGoogleForm(data);
}

async function loadTypeform(target: { url: string; id: string }, fetcher: Fetcher) {
  const page = await get(target.url, fetcher);
  if (page.status === 404) throw new ImportError("There's no typeform at that link.");
  let definition =
    page.status === 200 ? findTypeformDefinition(extractTypeformJson(page.body)) : null;
  if (!definition) {
    // The renderer's own definition endpoint for embeds.
    const api = await get(`https://api.typeform.com/single-embed/${target.id}`, fetcher);
    if (api.status === 200) {
      try {
        definition = findTypeformDefinition(JSON.parse(api.body));
      } catch {
        definition = null;
      }
    }
  }
  if (!definition) {
    throw new ImportError(
      "That typeform couldn't be read. Check it's published and anyone with the link can open it.",
    );
  }
  return parseTypeform(definition);
}

/** Fetches and converts a public form. Throws ImportError with a message
 * for the creator. */
export async function importFromUrl(
  raw: string,
  fetcher: Fetcher = defaultFetch,
): Promise<{ schema: FormSchemaV1; report: ImportReport }> {
  const target = importTarget(raw);
  if ("error" in target) throw new ImportError(target.error);

  let source: ImportSource;
  let form;
  let url = target.url;
  if (target.kind === "google_short") {
    const short = await get(target.url, fetcher);
    const next = short.location ? new URL(short.location, target.url) : null;
    const resolved = next ? importTarget(next.toString()) : null;
    if (!resolved || "error" in resolved || resolved.kind !== "google_forms") {
      throw new ImportError("That forms.gle link doesn't lead to a Google Form.");
    }
    url = resolved.url;
    source = "google_forms";
    form = await loadGoogle(url, fetcher);
  } else if (target.kind === "google_forms") {
    source = "google_forms";
    form = await loadGoogle(url, fetcher);
  } else {
    source = "typeform";
    form = await loadTypeform(target, fetcher);
  }
  if (form.items.length === 0) {
    throw new ImportError("That form has no questions to import.");
  }
  return buildImportedSchema(form, { kind: source, url });
}
