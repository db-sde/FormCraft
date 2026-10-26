import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Browsers must use the declared content type, never guess.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
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

export default nextConfig;
