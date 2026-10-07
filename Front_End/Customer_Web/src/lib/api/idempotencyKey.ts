/**
 * Generates one caller-owned Idempotency-Key per immutable Booking Hold
 * attempt, using the browser's cryptographically secure randomness. Never
 * uses `Math.random`, a timestamp, or request/contact data as entropy.
 */

const KEY_PREFIX = "bha-hold";

export function generateIdempotencyKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Secure random key generation (crypto.randomUUID) is not available.");
  }

  return `${KEY_PREFIX}-${crypto.randomUUID()}`;
}
