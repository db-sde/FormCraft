import "server-only";
import { PostHog } from "posthog-node";

let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;

  const apiKey = process.env.POSTHOG_SERVER_API_KEY;
  if (!apiKey) {
    client = null;
    return client;
  }

  client = new PostHog(apiKey, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    // Serverless route handlers don't stay alive long enough for the
    // SDK's default batching/interval flush, so send each event as its
    // own request immediately instead.
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

/**
 * Best-effort server-side event capture. Never throws: this always
 * runs alongside a real side effect (recording our own funnel numbers,
 * or a response that already completed successfully) and a missing
 * API key or a PostHog outage must never affect that.
 */
export async function captureServerEvent(params: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  const ph = getClient();
  if (!ph) return;

  try {
    ph.capture({
      distinctId: params.distinctId,
      event: params.event,
      properties: params.properties,
    });
    await ph.flush();
  } catch {
    // Swallow — see function doc.
  }
}
