const MARKER_KEY = "bha.direct-booking.unresolved";

/**
 * BHA-CHECKOUT-001-PR08: the ONLY thing about a Direct attempt that survives a reload — a flag that one may be
 * unresolved. Never the body, the contact, the idempotency key, the guest token or any other PII/credential.
 * Per tab (sessionStorage); where storage is unavailable it degrades to memory for this page load.
 */
export interface DirectAttemptMarker {
  isSet: () => boolean;
  set: () => void;
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
}

type MarkerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createDirectAttemptMarker(storage: MarkerStorage | null): DirectAttemptMarker {
  let inMemory = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    isSet: () => {
      try {
        if (storage?.getItem(MARKER_KEY) === "1") return true;
      } catch {
        /* storage refused: the in-memory flag below still answers */
      }
      return inMemory;
    },
    set: () => {
      inMemory = true;
      try {
        storage?.setItem(MARKER_KEY, "1");
      } catch {
        /* kept in memory for this page load only */
      }
      notify();
    },
    clear: () => {
      inMemory = false;
      try {
        storage?.removeItem(MARKER_KEY);
      } catch {
        /* nothing more to do */
      }
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function browserStorage(): MarkerStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The tab's marker. Lazily bound so importing this module on the server touches nothing. */
let shared: DirectAttemptMarker | undefined;
export function getDirectAttemptMarker(): DirectAttemptMarker {
  shared ??= createDirectAttemptMarker(browserStorage());
  return shared;
}
