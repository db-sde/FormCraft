import { EMBED_SDK_SOURCE } from "@/domains/forms/embed-sdk";

/** The embed SDK (F-24), loaded by other sites with a <script> tag. */
export function GET() {
  return new Response(EMBED_SDK_SOURCE, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "cross-origin-resource-policy": "cross-origin",
      "access-control-allow-origin": "*",
    },
  });
}
