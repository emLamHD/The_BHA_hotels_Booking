import type { IdentityChangePhase } from "@/lib/customerIdentityChange";
import type { CustomerSessionState } from "@/lib/customerSession";

/**
 * CUST-WEB-001-CP04. What `/account` may show, decided from the provider's whole `me` state and its identity
 * phase — React-free so the page renders exactly this and the tests exercise the same function. The email
 * comes from the provider's `me` and nowhere else; it is shown only for `authenticated` while no identity
 * change is under way, and the login redirect happens only for an `anonymous` the provider has verified
 * while idle. `loading`, `unknown` and any pending/recovering identity change are neither: they decide
 * nothing, show nothing private and leave the page where it is.
 */

export type AccountView =
  /** Verified, idle: the only view with PII. `email` is `me`'s, byte for byte. */
  | { kind: "ready"; email: string }
  /** Verified anonymous, idle: go to the login page. No PII while the redirect happens. */
  | { kind: "redirect-login" }
  /** The first/ordinary read is running. Nothing known yet. */
  | { kind: "checking" }
  /** A guarded login/logout or its `me` read is running: neither "signed in" nor "signed out" yet. */
  | { kind: "pending" }
  /** The session could not be read (ordinary failure or a failed recovery): re-check, no redirect, no PII. */
  | { kind: "unresolved" };

export function describeAccountView(state: CustomerSessionState, phase: IdentityChangePhase): AccountView {
  switch (phase) {
    case "transport":
    case "recovering":
      return { kind: "pending" };
    case "recovery-unresolved":
      return { kind: "unresolved" };
    case "idle":
      switch (state.status) {
        case "authenticated":
          return { kind: "ready", email: state.customer.email };
        case "anonymous":
          return { kind: "redirect-login" };
        case "loading":
          return { kind: "checking" };
        case "unknown":
          return { kind: "unresolved" };
      }
  }
}
