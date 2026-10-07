const ENV_VAR_NAME = "NEXT_PUBLIC_API_BASE_URL";

/**
 * Where to look, appended to every rejection so the message stays actionable
 * without quoting anything the operator configured.
 */
const WHERE_TO_FIX = `Fix ${ENV_VAR_NAME} in .env.local (see .env.local.example). The configured value is not repeated here.`;

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
 *
 * Correction C8: a rejected value is never quoted back — not raw, not trimmed,
 * not re-serialized from the parsed URL, and not by way of the parser's own
 * exception. The previous implementation redacted only values containing `@`,
 * which covered `https://user:secret@host` but echoed everything else; a token
 * pasted into the query or fragment (`?token=…`, `#access_token=…`) — the two
 * places one most often ends up — went verbatim into `Error.message`, and from
 * there into the browser console, a configuration-error screen and deployment
 * logs. `httpClient` copies this message into `ApiConfigError`, so it is
 * browser-reachable.
 *
 * The replacement is not a better heuristic but the absence of one: nothing
 * about the value is disclosed, so nothing depends on guessing which values
 * are secret. Secrecy is not a property this module can detect — a bare
 * hostname can be as confidential as a token — and any parameter-name
 * allowlist, partial mask or "sanitized origin" would leak whatever it failed
 * to anticipate. Naming the variable and the violated rule is enough to fix
 * the configuration; the operator can already read the value they set.
 */
function normalizeBaseUrl(rawValue: string): string {
  const trimmed = rawValue.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // The parser's message embeds the input, so it is discarded rather than
    // chained — `cause` would travel with the error and reach the same places.
    throw new Error(
      `${ENV_VAR_NAME} must be an absolute https URL, for example https://api.example.com. ${WHERE_TO_FIX}`
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `${ENV_VAR_NAME} must use https:// — the API redirects http to https, which breaks ` +
        `credentialed CORS preflight. ${WHERE_TO_FIX}`
    );
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${ENV_VAR_NAME} must not embed URL credentials. ${WHERE_TO_FIX}`);
  }

  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error(
      `${ENV_VAR_NAME} must not contain a query string or fragment — it is a base URL, ` +
        `not a request. ${WHERE_TO_FIX}`
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
