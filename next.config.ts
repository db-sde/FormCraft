import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Don't advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,
  // A second local build (the admin surface, for its browser tests) can
  // live beside the customer one.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Browsers must use the declared content type, never guess.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Permissions-Policy is set per request in src/proxy.ts: forms
          // may use the camera and microphone (video and audio answers,
          // roadmap #21), nothing else may.
        ],
      },
      {
        // The signed-in app must never render inside another site's
        // frame (clickjacking). The Content-Security-Policy, with
        // frame-ancestors, is set per request in src/proxy.ts; this is
        // for older browsers. Published forms (/f/) are meant to be
        // embedded.
        source: "/((?!f/).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

/**
 * With Sentry's build token set (Vercel, production), upload source maps
 * so error reports show real file names and lines, then delete them from
 * the build so they're never served. Without it the build is unchanged.
 */
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      telemetry: false,
      widenClientFileUpload: true,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;
