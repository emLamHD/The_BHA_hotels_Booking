/**
 * PMS-CAL-001.1: HTTPS-only Admin API base URL resolution.
 *
 * `NEXT_PUBLIC_API_BASE_URL` must be an absolute `https://` URL with no
 * credentials, query string, or fragment, normalized without a trailing
 * slash. `https://localhost` values are allowed for local development, but
 * plain `http://` is rejected outright — including `http://localhost` —
 * so the Calendar client can never silently fall back to an insecure
 * transport.
 */

export type ApiBaseUrlErrorReason =
  | "missing"
  | "invalid-url"
  | "not-https"
  | "has-credentials-or-query-or-fragment";

export type ApiBaseUrlResult =
  | { ok: true; baseUrl: string }
  | { ok: false; reason: ApiBaseUrlErrorReason };

function normalize(rawUrl: URL): string {
  const path = rawUrl.pathname === "/" ? "" : rawUrl.pathname.replace(/\/+$/, "");
  return `${rawUrl.protocol}//${rawUrl.host}${path}`;
}

export function resolveApiBaseUrl(rawValue: string | undefined | null): ApiBaseUrlResult {
  if (!rawValue || rawValue.trim() === "") {
    return { ok: false, reason: "missing" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue.trim());
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "not-https" };
  }

  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    return { ok: false, reason: "has-credentials-or-query-or-fragment" };
  }

  return { ok: true, baseUrl: normalize(parsed) };
}

export function describeApiBaseUrlError(reason: ApiBaseUrlErrorReason): string {
  switch (reason) {
    case "missing":
      return "NEXT_PUBLIC_API_BASE_URL is not configured.";
    case "invalid-url":
      return "NEXT_PUBLIC_API_BASE_URL is not a valid URL.";
    case "not-https":
      return "NEXT_PUBLIC_API_BASE_URL must use https:// — plain http:// (including localhost) is rejected.";
    case "has-credentials-or-query-or-fragment":
      return "NEXT_PUBLIC_API_BASE_URL must not contain credentials, a query string, or a fragment.";
    default:
      return "NEXT_PUBLIC_API_BASE_URL is invalid.";
  }
}

export function getApiBaseUrl(): ApiBaseUrlResult {
  return resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);
}
