import type { Translate } from "@/lib/i18n/types";
import type { CustomerCredentials } from "@/lib/api/authService";
import { ApiHttpError } from "@/lib/api/errors";
import { EMAIL_MAX_LENGTH, LOGIN_PAGE, PASSWORD_MAX_LENGTH } from "@/lib/customerAuthUi";
import type { CustomerSessionState } from "@/lib/customerSession";

/**
 * CUST-WEB-001-CP03. The decisions behind the Customer signup UI, kept React-free so the component only
 * renders them and the tests exercise the very same functions. Registering creates an account and nothing
 * else: it never signs anyone in, so nothing here touches the session provider, `me`, the booking flow or the
 * identity coordinator, and no result of a registration is ever read as "who the customer is".
 */

/** The API's rule (ASP.NET Core Identity options in Program.cs); the server stays the authority for the rest. */
export const PASSWORD_MIN_LENGTH = 12;

/* ------------------------------------------------------------------------- validation */

export interface SignupFieldErrors {
  email?: string;
  password?: string;
  confirmation?: string;
}

export type SignupField = "email" | "password" | "confirmation";

export type SignupValidation =
  | { ok: true; credentials: CustomerCredentials }
  | { ok: false; errors: SignupFieldErrors; focus: SignupField };

/**
 * Client-side check before anything is sent. The email is trimmed; the password and its confirmation are
 * compared and sent exactly as typed — never trimmed, normalised or cut. Only what the API states as a plain
 * length or presence rule is enforced here (UTF-16 length, as .NET counts it); the character-class rules
 * (upper, lower, digit, symbol) are shown to the user and decided by the server, whose 400 is handled.
 */
export function validateSignupInput(emailRaw: string, passwordRaw: string, confirmationRaw: string): SignupValidation {
  const email = emailRaw.trim();
  const errors: SignupFieldErrors = {};
  if (email.length === 0) {
    errors.email = "customer.auth.validation.emailRequired";
  } else if (email.length > EMAIL_MAX_LENGTH) {
    errors.email = "customer.auth.validation.emailTooLong";
  } else if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    errors.email = "customer.auth.validation.emailInvalid";
  }
  if (passwordRaw.trim().length === 0) {
    errors.password = "customer.auth.validation.passwordRequired";
  } else if (passwordRaw.length < PASSWORD_MIN_LENGTH) {
    errors.password = "customer.signup.validation.passwordMin";
  } else if (passwordRaw.length > PASSWORD_MAX_LENGTH) {
    errors.password = "customer.auth.validation.passwordTooLong";
  }
  if (confirmationRaw.length === 0) {
    errors.confirmation = "customer.signup.validation.confirmationRequired";
  } else if (confirmationRaw !== passwordRaw) {
    errors.confirmation = "customer.signup.validation.confirmationMismatch";
  }
  const focus: SignupField | null = errors.email ? "email" : errors.password ? "password" : errors.confirmation ? "confirmation" : null;
  if (focus) return { ok: false, errors, focus };
  return { ok: true, credentials: { email, password: passwordRaw } };
}

/* ------------------------------------------------------------------------- outcome */

/**
 * What the register request did, from the Customer's point of view:
 *  - `created`: the API answered 201 with a body `registerCustomer` accepted. Still not signed in.
 *  - `invalid` (400), `exists` (409), `rate-limited` (429): the API's documented refusals of this request.
 *  - `uncertain`: anything else — network loss, 408, 5xx, an unexpected status, a malformed 2xx. The account
 *    may or may not exist; nothing here concludes either way, and a later 409 does not change that.
 */
export type SignupOutcome = "created" | "invalid" | "exists" | "rate-limited" | "uncertain";

export function signupOutcomeOf(error: unknown): Exclude<SignupOutcome, "created"> {
  if (error instanceof ApiHttpError) {
    if (error.status === 400) return "invalid";
    if (error.status === 409) return "exists";
    if (error.status === 429) return "rate-limited";
  }
  return "uncertain";
}

export type SignupTone = "success" | "error" | "warning";

export interface SignupPresentation {
  outcome: SignupOutcome;
  tone: SignupTone;
  message: string;
  /** Where to go next; always the login page, never carrying the email or anything else. */
  link: { href: string; label: string } | null;
}

const CREATED_MESSAGE: Record<CustomerSessionState["status"], string> = {
  anonymous: "customer.signup.created.anonymous",
  authenticated: "customer.signup.created.authenticated",
  unknown: "customer.signup.created.unknown",
  loading: "customer.signup.created.unknown",
};

/**
 * What to tell the user. Fixed wording per outcome (a pack message in the visitor's language): nothing from the server's response (title,
 * detail, field messages) or from the credentials is ever shown. `sessionStatus` is the provider's own
 * `me` state, passed through whole: a registration neither changes nor verifies the session, so the account
 * outcome ("created") and what is known about the session stay separate. "Not signed in" is said only for
 * an `anonymous` the provider has verified; `unknown`/`loading` say nothing about the current session.
 */
export function presentSignupOutcome(outcome: SignupOutcome, sessionStatus: CustomerSessionState["status"], t: Translate): SignupPresentation {
  const login = { href: LOGIN_PAGE, label: t("customer.auth.entry.signIn") };
  switch (outcome) {
    case "created":
      return {
        outcome,
        tone: "success",
        message: t(CREATED_MESSAGE[sessionStatus]),
        link: login,
      };
    case "invalid":
      return {
        outcome,
        tone: "error",
        message: `${t("customer.signup.invalid")} ${t("customer.signup.passwordRequirements", { min: PASSWORD_MIN_LENGTH })}`,
        link: null,
      };
    case "exists":
      return {
        outcome,
        tone: "error",
        message: t("customer.signup.exists"),
        link: login,
      };
    case "rate-limited":
      return {
        outcome,
        tone: "warning",
        message: t("customer.signup.rateLimited"),
        link: null,
      };
    case "uncertain":
      return {
        outcome,
        tone: "warning",
        message: t("customer.signup.uncertain"),
        link: login,
      };
  }
}

/* ------------------------------------------------------------------------- one attempt at a time */

export type RegisterCall = (credentials: CustomerCredentials) => Promise<unknown>;

export interface SignupOwner {
  /** Synchronous: true from the moment `submit` accepts an attempt until its outcome is delivered or disposed. */
  isBusy: () => boolean;
  /**
   * Sends one registration unless this owner already has one running or is disposed; returns whether it
   * started. The check and the claim are one synchronous step, so two events in the same tick send one
   * request — a disabled button rendered by React is presentation, never the guard. `onSettled` runs only
   * for the current attempt of a live owner: never after `dispose`, so a late response of a component that
   * is gone can neither show a message nor navigate.
   */
  submit: (credentials: CustomerCredentials, onSettled: (outcome: SignupOutcome) => void) => boolean;
  /**
   * The component is going away. The request already sent is not cancelled — an abort would prove nothing
   * about whether the server created the account — and its answer is dropped.
   */
  dispose: () => void;
}

/** `register` is `registerCustomer` in the app; the owner calls it once per accepted attempt and nothing else. */
export function createSignupOwner(register: RegisterCall): SignupOwner {
  let busy = false;
  let disposed = false;
  let attempt = 0;
  return {
    isBusy: () => busy,
    submit: (credentials, onSettled) => {
      if (busy || disposed) return false;
      busy = true;
      const mine = ++attempt;
      const deliver = (outcome: SignupOutcome) => {
        if (mine !== attempt) return;
        busy = false;
        if (!disposed) onSettled(outcome);
      };
      let sent: Promise<unknown>;
      try {
        sent = register(credentials);
      } catch (error) {
        deliver(signupOutcomeOf(error));
        return true;
      }
      sent.then(
        () => deliver("created"),
        (error) => deliver(signupOutcomeOf(error))
      );
      return true;
    },
    dispose: () => {
      disposed = true;
      busy = false;
      attempt += 1;
    },
  };
}
