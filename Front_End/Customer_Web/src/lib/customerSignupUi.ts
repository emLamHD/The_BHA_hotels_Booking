import type { CustomerCredentials } from "@/lib/api/authService";
import { ApiHttpError } from "@/lib/api/errors";
import { EMAIL_MAX_LENGTH, LOGIN_PAGE, PASSWORD_MAX_LENGTH } from "@/lib/customerAuthUi";

/**
 * CUST-WEB-001-CP03. The decisions behind the Customer signup UI, kept React-free so the component only
 * renders them and the tests exercise the very same functions. Registering creates an account and nothing
 * else: it never signs anyone in, so nothing here touches the session provider, `me`, the booking flow or the
 * identity coordinator, and no result of a registration is ever read as "who the customer is".
 */

/** The API's rule (ASP.NET Core Identity options in Program.cs); the server stays the authority for the rest. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_REQUIREMENTS = `Ít nhất ${PASSWORD_MIN_LENGTH} ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.`;

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
    errors.email = "Nhập địa chỉ email.";
  } else if (email.length > EMAIL_MAX_LENGTH) {
    errors.email = `Email tối đa ${EMAIL_MAX_LENGTH} ký tự.`;
  } else if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    errors.email = "Địa chỉ email chưa hợp lệ.";
  }
  if (passwordRaw.trim().length === 0) {
    errors.password = "Nhập mật khẩu.";
  } else if (passwordRaw.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`;
  } else if (passwordRaw.length > PASSWORD_MAX_LENGTH) {
    errors.password = `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự.`;
  }
  if (confirmationRaw.length === 0) {
    errors.confirmation = "Nhập lại mật khẩu.";
  } else if (confirmationRaw !== passwordRaw) {
    errors.confirmation = "Mật khẩu nhập lại không khớp.";
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

/**
 * What to tell the user. Fixed Vietnamese wording per outcome: nothing from the server's response (title,
 * detail, field messages) or from the credentials is ever shown. `sessionAuthenticated` is the provider's
 * verdict; a registration does not change it, so the message must not claim otherwise.
 */
export function presentSignupOutcome(outcome: SignupOutcome, sessionAuthenticated: boolean): SignupPresentation {
  const login = { href: LOGIN_PAGE, label: "Đăng nhập" };
  switch (outcome) {
    case "created":
      return {
        outcome,
        tone: "success",
        message: sessionAuthenticated
          ? "Tạo tài khoản thành công. Việc đăng ký không thay đổi phiên đăng nhập hiện tại."
          : "Tạo tài khoản thành công. Bạn chưa đăng nhập.",
        link: login,
      };
    case "invalid":
      return {
        outcome,
        tone: "error",
        message: `Không thể tạo tài khoản với thông tin này. Hãy kiểm tra lại email và mật khẩu. ${PASSWORD_REQUIREMENTS}`,
        link: null,
      };
    case "exists":
      return {
        outcome,
        tone: "error",
        message: "Không thể tạo tài khoản với email này. Hãy đăng nhập nếu bạn đã có tài khoản, hoặc dùng email khác.",
        link: login,
      };
    case "rate-limited":
      return {
        outcome,
        tone: "warning",
        message: "Có quá nhiều yêu cầu đăng ký. Hãy đợi một lúc rồi thử lại.",
        link: null,
      };
    case "uncertain":
      return {
        outcome,
        tone: "warning",
        message:
          "Chưa xác nhận được tài khoản đã được tạo hay chưa (kết nối hoặc máy chủ gặp sự cố). Bạn có thể đăng nhập bằng email và mật khẩu vừa nhập, hoặc tự đăng ký lại.",
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
