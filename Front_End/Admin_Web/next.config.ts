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
    // (SameSite=Strict, Path=/api/admin) stays first-party. Only the Staff namespace is forwarded — not
    // the Customer /api/v1, health or any other path — and the prefix, suffix and query are kept.
    return {
      beforeFiles: [
        {
          source: "/api/admin/v1/:path*",
          destination: `${apiProxyOrigin}/api/admin/v1/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
