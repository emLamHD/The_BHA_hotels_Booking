const { resolveApiProxyOrigin } = require("./scripts/api-proxy-origin.cjs");

// BHA-WEB-PROXY-001: opt-in same-origin API proxy. Unset/blank keeps the direct mode; a malformed value
// throws here, at config load, so a bad deployment fails its build instead of proxying somewhere else.
const apiProxyOrigin = resolveApiProxyOrigin(process.env);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Build-time flag read by src/middleware.ts: `/api/*` stays closed (404) unless this build also baked
  // the rewrite below, so the middleware and the rewrite can never disagree. Always defined, so a runtime
  // environment variable of the same name cannot open `/api/*` in a build without the proxy. A boolean,
  // not the origin.
  env: { BHA_API_PROXY_ENABLED: apiProxyOrigin ? "true" : "false" },
  experimental: {
    appDir: true,
    typedRoutes: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.pexels.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "a0.muscache.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "www.gstatic.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
  // BHA-CHECKOUT-001-PR09: the guest's management page (the e-mail link `/reservations/{id}/manage#<secret>`) and nothing else. The secret lives in
  // the fragment, which a browser does not send, but the page must still never be cached, indexed or named as a referrer to another site.
  // Cache-Control is deliberately NOT set here: for a page Next replaces it with its own value, and the page is `force-dynamic`, which makes that value
  // `private, no-cache, no-store, max-age=0, must-revalidate` (checked on `next start`; see the PR09 runbook).
  async headers() {
    return [
      {
        source: "/reservations/:reservationId/manage",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  async rewrites() {
    if (!apiProxyOrigin) {
      return [];
    }
    // A rewrite, never a redirect: the browser keeps talking to the Customer origin, so the API's
    // cookies stay first-party. The /api prefix, the rest of the path and the query string are kept.
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${apiProxyOrigin}/api/:path*`,
        },
      ],
    };
  },
};

module.exports = nextConfig;
