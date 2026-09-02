const ENV_VAR_NAME = "NEXT_PUBLIC_API_BASE_URL";

/**
 * Keeps a rejected value out of the error message when it carries URL
 * credentials, so a misconfigured `https://user:secret@host` never reaches a
 * log or a browser console.
 */
function describeValue(rawValue: string): string {
  return rawValue.includes("@") ? "<redacted>" : `"${rawValue}"`;
}

/**
 * PMS-CAL-001.1 correction C6: the API base must be an absolute `https://`
 * URL.
 *
 * The API applies `UseHttpsRedirection()` globally, so an `http://` base makes
 * the browser send every credentialed/JSON request's CORS preflight to the
 * HTTP listener and receive a cross-origin redirect to HTTPS. Browsers do not
 * reliably follow redirects for preflight requests, so booking and
 * authentication would fail before the real request was ever sent — and fail
 * in a way that looks like an intermittent CORS problem rather than a
 * configuration mistake. Rejecting `http://` here turns that into an
 * immediate, explicit configuration error instead.
 *
 * The value is deliberately never rewritten from `http://` to `https://` on
 * the caller's behalf: a wrong base URL is a deployment mistake to fix, not
 * something to silently paper over. Well-formedness is decided by real URL
 * parsing, not by a regex.
 */
function normalizeBaseUrl(rawValue: string): string {
  const trimmed = rawValue.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `${ENV_VAR_NAME} must be an absolute https URL, received: ${describeValue(rawValue)}`
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `${ENV_VAR_NAME} must use https:// — the API redirects http to https, which breaks ` +
        `credentialed CORS preflight. Received: ${describeValue(rawValue)}`
    );
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${ENV_VAR_NAME} must not embed URL credentials.`);
  }

  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error(
      `${ENV_VAR_NAME} must not contain a query string or fragment, received: ${describeValue(rawValue)}`
    );
  }

  return trimmed.replace(/\/+$/, "");
}

let cachedBaseUrl: string | undefined;

/**
 * Reads and validates NEXT_PUBLIC_API_BASE_URL on first use. Throws rather
 * than falling back to another URL when the value is absent or malformed, and
 * caches only a value that has passed validation.
 */
export function getApiBaseUrl(): string {
  if (cachedBaseUrl !== undefined) {
    return cachedBaseUrl;
  }

  const rawValue = process.env.NEXT_PUBLIC_API_BASE_URL;

  if (!rawValue || rawValue.trim() === "") {
    throw new Error(
      `${ENV_VAR_NAME} is not configured. Set it in .env.local (see .env.local.example).`
    );
  }

  cachedBaseUrl = normalizeBaseUrl(rawValue);
  return cachedBaseUrl;
}

/** Test-only: clears the cached base URL so env changes take effect. */
export function resetApiBaseUrlCacheForTests(): void {
  cachedBaseUrl = undefined;
}
