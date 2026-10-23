import type { NextConfig } from "next";
import { resolveApiProxyOrigin } from "./scripts/api-proxy-origin";

// BHA-ADMIN-PROXY-001: opt-in same-origin proxy for the Staff API. Unset/blank keeps the direct mode; a
// malformed value throws here, at config load, so a bad deployment fails its build instead of proxying
// somewhere else.
const apiProxyOrigin = resolveApiProxyOrigin(process.env);

const nextConfig: NextConfig = {
  /* config options here */
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });
    return config;
  },

    turbopack: {
      rules: {
        '*.svg': {
          loaders: ['@svgr/webpack'],
          as: '*.js',
        },
      },
    },

  async rewrites() {
    if (!apiProxyOrigin) {
      return [];
    }
    // A rewrite, never a redirect: the browser keeps talking to the Admin origin, so the Staff cookie
    // (SameSite=Strict, Path=/api/admin) stays first-party. The Staff namespace is forwarded with its prefix,
    // suffix and query, and so are the two public reference reads the Admin makes (BHA-BLOG-001-CP03-C7):
    // the website's active languages and the active Properties. They are exact paths, uncredentialed, and
    // the Staff cookie's Path never reaches them; the rest of the Customer /api/v1, health and every other
    // path is still not forwarded.
    return {
      beforeFiles: [
        {
          source: "/api/admin/v1/:path*",
          destination: `${apiProxyOrigin}/api/admin/v1/:path*`,
        },
        { source: "/api/v1/website/config", destination: `${apiProxyOrigin}/api/v1/website/config` },
        { source: "/api/v1/properties", destination: `${apiProxyOrigin}/api/v1/properties` },
      ],
    };
  },
};

export default nextConfig;
