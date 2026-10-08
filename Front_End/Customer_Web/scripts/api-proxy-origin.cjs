/**
 * BHA-WEB-PROXY-001: reads and validates the opt-in `API_PROXY_ORIGIN` for the same-origin API proxy
 * configured in next.config.js. Kept in its own CommonJS file so the config stays a plain
 * `module.exports = nextConfig` and the rules can be unit tested without loading Next.
 *
 * Like src/lib/api/env.ts, a rejected value is never quoted back — not raw, not re-serialized, and not
 * through the URL parser's own exception — because the message reaches build logs. The messages name
 * the variable and the violated rule only.
 */

const ENV_VAR_NAME = "API_PROXY_ORIGIN";

const WHERE_TO_FIX =
  `Fix ${ENV_VAR_NAME} (see .env.local.example and README.md). The configured value is not repeated here.`;

function fail(rule) {
  throw new Error(`${ENV_VAR_NAME} ${rule} ${WHERE_TO_FIX}`);
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * Origins this Customer deployment is served from: the browser-facing API base (which in proxy mode is
 * the Customer origin itself) plus Vercel's own deployment hosts when the build exposes them. An
 * upstream equal to any of them would make the proxy call itself.
 */
function frontendOrigins(env) {
  const origins = new Set();
  const apiBase = env.NEXT_PUBLIC_API_BASE_URL;
  if (apiBase && apiBase.trim() !== "") {
    origins.add(originOf(apiBase.trim()));
  }
  for (const name of ["VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) {
    const host = env[name];
    if (host && host.trim() !== "") {
      origins.add(originOf(`https://${host.trim()}`));
    }
  }
  origins.delete(undefined);
  return origins;
}

/**
 * Returns the normalized upstream origin (no trailing slash), or `undefined` when the proxy is not
 * enabled (variable unset or blank) — the local direct mode. Throws on any malformed value instead of
 * falling back: no http, no disabled TLS verification, no silent disable.
 */
function resolveApiProxyOrigin(env) {
  const raw = env[ENV_VAR_NAME];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const trimmed = raw.trim();

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    // The parser's message embeds the input, so it is discarded rather than chained.
    return fail("must be an absolute https origin, for example https://api.example.com.");
  }

  if (parsed.protocol !== "https:") {
    return fail("must use https://; the proxy never falls back to http.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return fail("must not embed URL credentials.");
  }
  // The raw text is checked as well: the parser reports an empty `?` / `#` as no query / fragment.
  if (parsed.search !== "" || parsed.hash !== "" || /[?#]/.test(trimmed)) {
    return fail("must not contain a query string or fragment; it is an origin, not a request.");
  }
  if (parsed.pathname !== "/") {
    return fail("must be a bare origin without a path.");
  }

  if (frontendOrigins(env).has(parsed.origin)) {
    return fail(
      "must not point at this frontend's own origin (NEXT_PUBLIC_API_BASE_URL or the Vercel deployment host); " +
        "that would make the proxy forward to itself."
    );
  }

  return parsed.origin;
}

module.exports = { resolveApiProxyOrigin, API_PROXY_ENV_VAR_NAME: ENV_VAR_NAME };
