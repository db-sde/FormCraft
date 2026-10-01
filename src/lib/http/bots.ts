/**
 * Best-effort detection of crawlers and link-preview fetchers, so they
 * don't inflate a form's Views (PRD P1.20 asks for bot traffic to be
 * excluded where feasible). Sharing a form link in WhatsApp, Slack,
 * LinkedIn or iMessage makes their servers fetch the page — each one
 * used to count as a view. Not a security control: a determined bot
 * can claim any user agent.
 */
const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|linkedin|twitter|pinterest|embedly|quora|skype|vkshare|w3c_validator|headlesschrome|lighthouse|pingdom|uptime|monitor|curl\/|wget\/|python-requests|go-http-client|axios\/|node-fetch|postmanruntime/i;

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  // No user agent at all is not a browser.
  if (!userAgent) return true;
  return BOT_PATTERN.test(userAgent);
}
