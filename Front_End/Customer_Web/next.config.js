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
