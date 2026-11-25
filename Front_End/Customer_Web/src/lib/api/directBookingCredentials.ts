/**
 * BHA-CHECKOUT-001-PR08: the credentials of one Direct reservation attempt, from the browser's CSPRNG only
 * (never Math.random, a timestamp or request data). Neither value is ever logged, stored or put in a URL.
 */

export function generateDirectIdempotencyKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Secure random key generation (crypto.randomUUID) is not available.");
  }
  return `bha-direct-${crypto.randomUUID()}`;
}

/** 32 random bytes, base64url WITHOUT padding (43 characters): the guest owner token the API stores only as a hash. */
export function generateGuestAccessToken(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure random generation (crypto.getRandomValues) is not available.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
