const ENV_VAR_NAME = "NEXT_PUBLIC_API_BASE_URL";

function normalizeBaseUrl(rawValue: string): string {
  const trimmed = rawValue.trim();

  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error(
      `${ENV_VAR_NAME} must be an absolute http or https URL, received: "${rawValue}"`
    );
  }

  try {
    // eslint-disable-next-line no-new -- validates well-formedness only
    new URL(trimmed);
  } catch {
    throw new Error(
      `${ENV_VAR_NAME} must be a valid URL, received: "${rawValue}"`
    );
  }

  return trimmed.replace(/\/+$/, "");
}

let cachedBaseUrl: string | undefined;

/**
 * Reads and validates NEXT_PUBLIC_API_BASE_URL on first use. Throws rather
 * than falling back to another URL when the value is absent or malformed.
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
