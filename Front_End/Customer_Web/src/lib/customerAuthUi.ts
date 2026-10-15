import type { Translate } from "@/lib/i18n/types";
import type { CustomerCredentials } from "@/lib/api/authService";
import type { BookingHoldFlowState } from "@/lib/api/bookingHoldFlow";
import { ApiHttpError } from "@/lib/api/errors";
import type { IdentityChangePhase, IdentityCommandResult } from "@/lib/customerIdentityChange";
import type { CustomerSessionState } from "@/lib/customerSession";

/**
 * CUST-WEB-001-CP02. The decisions behind the Customer auth UI, kept React-free so the components only
 * render them and the tests exercise the very same functions. Nothing here talks to the network: the UI
 * reaches the API only through the provider's `guardedLogin` / `guardedLogout`, and what the Customer *is*
 * comes from the provider's `me`-backed state, never from a transport outcome.
 */

export const LOGIN_PAGE = "/login";
export const RECEIPT_ROUTE = "/paydone";
export const HOME_PAGE = "/";
export const ACCOUNT_PAGE = "/account";

/** The API's field limits (`LoginCustomerRequest`). */
export const EMAIL_MAX_LENGTH = 256;
export const PASSWORD_MAX_LENGTH = 128;

/* ------------------------------------------------------------------------- validation */

export interface LoginFieldErrors {
  email?: string;
  password?: string;
}

export type LoginValidation =
  | { ok: true; credentials: CustomerCredentials }
  | { ok: false; errors: LoginFieldErrors; focus: "email" | "password" };

/**
 * Client-side check before anything is sent. The email is trimmed (surrounding blanks are never part of an
 * address); the password is sent exactly as typed — never trimmed — and only an empty or all-blank one is
 * refused, as the API does. Limits are enforced here by message, not by `maxLength` on the input, which would
 * silently truncate a pasted password.
 */
export function validateLoginInput(emailRaw: string, passwordRaw: string): LoginValidation {
  const email = emailRaw.trim();
  const errors: LoginFieldErrors = {};
  if (email.length === 0) {
    errors.email = "customer.auth.validation.emailRequired";
  } else if (email.length > EMAIL_MAX_LENGTH) {
    errors.email = "customer.auth.validation.emailTooLong";
  } else if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    errors.email = "customer.auth.validation.emailInvalid";
  }
  if (passwordRaw.trim().length === 0) {
    errors.password = "customer.auth.validation.passwordRequired";
  } else if (passwordRaw.length > PASSWORD_MAX_LENGTH) {
    errors.password = "customer.auth.validation.passwordTooLong";
  }
  if (errors.email) return { ok: false, errors, focus: "email" };
  if (errors.password) return { ok: false, errors, focus: "password" };
  return { ok: true, credentials: { email, password: passwordRaw } };
}

/* ------------------------------------------------------------------------- command results */

export type AuthCommand = "login" | "logout";
/** `failed` is a command that rejected unexpectedly (the provider's commands resolve with a result). */
export type AuthUiResult = IdentityCommandResult | { status: "failed" };
export type AuthTone = "success" | "error" | "warning" | "info";

export interface AuthLink {
  href: string;
  label: string;
}

export interface AuthPresentation {
  tone: AuthTone;
  message: string;
  link: AuthLink | null;
  /** Show the read-only "check again" action (it only reads `me`). */
  offerRefresh: boolean;
}

export interface AuthPresentationContext {
  /** Where the in-progress booking can be resumed (from `inProgressBookingTarget`), if any. */
  bookingHref: string | null;
}

function httpStatusOf(error: unknown): number | null {
  return error instanceof ApiHttpError ? error.status : null;
}

/**
 * What to tell the user about a guarded login/logout. It reflects both what the auth request did
 * (`transport`) and the session `me` then verified (`session`): neither stands in for the other.
 * `null` means show nothing (an aborted command says nothing about the session).
 */
export function presentIdentityCommandResult(
  command: AuthCommand,
  result: AuthUiResult,
  context: AuthPresentationContext,
  t: Translate
): AuthPresentation | null {
  const present = (
    tone: AuthTone,
    message: string,
    extra: { link?: AuthLink; offerRefresh?: boolean } = {}
  ): AuthPresentation => ({ tone, message, link: extra.link ?? null, offerRefresh: extra.offerRefresh ?? false });

  switch (result.status) {
    case "aborted":
      return null;
    case "failed":
      return present("error", t(`customer.auth.failed.${command}`), { offerRefresh: true });
    case "blocked":
      switch (result.reason) {
        case "booking-in-progress":
          return present("warning", t(`customer.auth.blocked.booking.${command}`), {
            link: { href: context.bookingHref ?? HOME_PAGE, label: t("customer.auth.link.backToBooking") },
          });
        case "receipt-not-finished":
          return present(
            "warning",
            t(`customer.auth.blocked.receipt.${command}`),
            { link: { href: RECEIPT_ROUTE, label: t("customer.auth.link.openReceipt") } }
          );
        case "identity-change-in-progress":
          return present("info", t("customer.auth.blocked.identityChange"));
        case "booking-unbound":
        case "session-inactive":
          return present("warning", t("customer.auth.blocked.sessionNotReady"), {
            offerRefresh: true,
          });
      }
      return null;
    case "recovery-unresolved": {
      // The provider's own notice (describeSessionNotice) carries the read-only "check again" action.
      return present("warning", t(`customer.auth.unresolved.${result.transport === "succeeded" ? "succeeded" : result.transport === "refused" ? "refused" : "unknown"}`));
    }
    case "settled": {
      const authenticated = result.session === "authenticated";
      if (result.transport === "succeeded") {
        if (command === "login") {
          return authenticated
            ? present("success", t("customer.auth.login.success"))
            : present("warning", t("customer.auth.login.unconfirmed"));
        }
        return authenticated
          ? present("warning", t("customer.auth.logout.unconfirmed"))
          : present("success", t("customer.auth.logout.success"));
      }
      if (result.transport === "refused") {
        const status = httpStatusOf(result.transportError);
        if (status === 429) return present("warning", t("customer.auth.rateLimited"));
        if (command === "login") {
          const kept = authenticated ? "Kept" : "";
          return status === 401
            ? present("error", t(`customer.auth.login.badCredentials${kept}`))
            : present("error", t(`customer.auth.login.cannotProcess${kept}`));
        }
        return status === 401 && !authenticated
          ? present("info", t("customer.auth.logout.noSession"))
          : present("error", t("customer.auth.logout.cannotProcess"));
      }
      // lost: the request may or may not have changed the server session; `me` has told what it is now.
      return present("warning", t(`customer.auth.lost.${command}.${authenticated ? "authenticated" : "anonymous"}`));
    }
  }
}

/** Booking phases in which a guarded login/logout is refused as `booking-in-progress` (CP01b guard matrix). */
const BOOKING_LOCKED_PHASES: ReadonlySet<BookingHoldFlowState["phase"]> = new Set<BookingHoldFlowState["phase"]>([
  "submitting",
  "uncertain",
  "active-session",
  "confirming",
  "confirm-known-error",
  "confirm-uncertain",
]);

/**
 * A stored result is history once what it described is over: `recovery-unresolved` when the provider is
 * idle again (`me` answered), a `blocked` booking message when the booking no longer blocks. The UI then
 * stops showing it instead of leaving a stale warning.
 */
export function isStalePresentation(
  result: AuthUiResult,
  identityPhase: IdentityChangePhase,
  bookingPhase: BookingHoldFlowState["phase"]
): boolean {
  if (result.status === "recovery-unresolved") return identityPhase === "idle";
  if (result.status === "blocked") {
    if (result.reason === "booking-in-progress") return !BOOKING_LOCKED_PHASES.has(bookingPhase);
    if (result.reason === "receipt-not-finished") return bookingPhase !== "reservation-result";
  }
  return false;
}

/** A login the UI may celebrate and leave the page for: the request succeeded AND `me` says authenticated. */
export function loginSucceeded(result: AuthUiResult): boolean {
  return result.status === "settled" && result.transport === "succeeded" && result.session === "authenticated";
}

/* ------------------------------------------------------------------------- session / entry */

export interface SessionNotice {
  kind: "checking" | "busy" | "unresolved";
  message: string;
  /** Show the read-only "check again" action. */
  offerRefresh: boolean;
}

/**
 * The provider is the authority for "busy" and "needs a re-check": its `identityChange.phase` (while a
 * guarded command or its `me` recovery runs, and after a failed recovery) and its `me` state.
 */
export function describeSessionNotice(
  status: CustomerSessionState["status"],
  phase: IdentityChangePhase,
  t: Translate
): SessionNotice | null {
  switch (phase) {
    case "transport":
      return {
        kind: "busy",
        message: t("customer.auth.notice.transport"),
        offerRefresh: false,
      };
    case "recovering":
      return {
        kind: "busy",
        message: t("customer.auth.notice.recovering"),
        offerRefresh: false,
      };
    case "recovery-unresolved":
      return {
        kind: "unresolved",
        message: t("customer.auth.notice.unresolved"),
        offerRefresh: true,
      };
    case "idle":
      if (status === "loading") {
        return { kind: "checking", message: t("customer.auth.notice.checking"), offerRefresh: false };
      }
      if (status === "unknown") {
        return { kind: "unresolved", message: t("customer.auth.notice.unknown"), offerRefresh: true };
      }
      return null;
  }
}

export interface AuthEntry {
  /** Visible label where there is room for one (the mobile app bar). */
  label: string;
  ariaLabel: string;
  href: string;
  /** "busy" while the identity is being changed or checked, "attention" when a re-check is needed. */
  indicator: "none" | "busy" | "attention";
}

/**
 * The one auth entry shared by every header and the mobile app bar. A verified signed-in Customer goes to
 * `/account` (only while no identity change is under way); anonymous, loading, unknown and anything pending go to `/login` (the auth and status panel) — unknown is never
 * treated as anonymous, and `/account` is only offered once `me` has answered 200.
 */
export function describeAuthEntry(
  status: CustomerSessionState["status"],
  phase: IdentityChangePhase,
  email: string | null,
  t: Translate
): AuthEntry {
  const indicator: AuthEntry["indicator"] =
    phase === "transport" || phase === "recovering"
      ? "busy"
      : phase === "recovery-unresolved" || status === "unknown"
        ? "attention"
        : "none";
  if (status === "anonymous") {
    return { label: t("customer.auth.entry.signIn"), ariaLabel: t("customer.auth.entry.signIn"), href: LOGIN_PAGE, indicator };
  }
  if (status === "authenticated" && email) {
    return { label: t("customer.auth.entry.account"), ariaLabel: t("customer.auth.entry.accountEmail", { email }), href: phase === "idle" ? ACCOUNT_PAGE : LOGIN_PAGE, indicator };
  }
  return {
    label: t("customer.auth.entry.account"),
    ariaLabel: indicator === "attention" ? t("customer.auth.entry.attention") : t("customer.auth.entry.checking"),
    href: LOGIN_PAGE,
    indicator,
  };
}

/* ------------------------------------------------------------------------- one UI attempt at a time */

export interface AuthSubmissionOwner {
  /** Synchronous: true from the moment `run` accepts a command until its result is delivered or disposed. */
  isBusy: () => boolean;
  /**
   * Starts `command` unless this owner already has one running or is disposed; returns whether it started.
   * The check and the claim are one synchronous step, so two events in the same tick start one command —
   * a disabled button rendered by React is presentation, never the guard. `onSettled` runs only for the
   * current attempt of a live owner: never after `dispose`, so a late result of an unmounted component can
   * neither show a message nor navigate.
   */
  run: (command: () => Promise<IdentityCommandResult>, onSettled: (result: AuthUiResult) => void) => boolean;
  /** The component is going away. Whatever is in flight keeps running in the provider; nothing is delivered. */
  dispose: () => void;
}

export function createAuthSubmissionOwner(): AuthSubmissionOwner {
  let busy = false;
  let disposed = false;
  let attempt = 0;
  return {
    isBusy: () => busy,
    run: (command, onSettled) => {
      if (busy || disposed) return false;
      busy = true;
      const mine = ++attempt;
      const deliver = (result: AuthUiResult) => {
        if (mine !== attempt) return;
        busy = false;
        if (!disposed) onSettled(result);
      };
      let started: Promise<IdentityCommandResult>;
      try {
        started = command();
      } catch {
        deliver({ status: "failed" });
        return true;
      }
      started.then(deliver, () => deliver({ status: "failed" }));
      return true;
    },
    dispose: () => {
      disposed = true;
      busy = false;
      attempt += 1;
    },
  };
}

/* ------------------------------------------------------------------------- closing the receipt */

/**
 * The reservation a "close the receipt" action refers to — only a confirmed receipt in `reservation-result`.
 * The component captures this id when the confirmation dialog opens and hands that same id to
 * `finishBooking`, which refuses it if the receipt has changed since.
 */
export function receiptCloseTarget(state: BookingHoldFlowState): string | null {
  if (state.phase !== "reservation-result") return null;
  return state.reservationResult?.reservation.reservationId ?? null;
}

/** Why `finishBooking` said no. The receipt is untouched in every case. */
export function receiptCloseFailureMessage(phase: IdentityChangePhase): string {
  return phase === "idle" ? "customer.auth.receipt.changed" : "customer.auth.receipt.busy";
}
