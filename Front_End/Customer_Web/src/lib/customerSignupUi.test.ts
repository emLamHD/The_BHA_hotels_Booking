import { testT } from "@/lib/i18n/testkit";
import { describe, expect, it, vi } from "vitest";
import type { CustomerSessionState } from "@/lib/customerSession";
import { registerCustomer } from "@/lib/api/authService";
import { ApiHttpError, ApiNetworkError, ApiValidationError } from "@/lib/api/errors";
import {
  PASSWORD_MIN_LENGTH,
  SignupOutcome,
  createSignupOwner,
  presentSignupOutcome,
  signupOutcomeOf,
  validateSignupInput,
} from "@/lib/customerSignupUi";

const http = (status: number) => new ApiHttpError(status, { title: "x", status, detail: "SECRET-SERVER-DETAIL" });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const PASSWORD = "Aa1!aaaaaaaa"; // 12 characters: the shortest the API accepts
const credentials = { email: "bob@example.test", password: PASSWORD };

/* ------------------------------------------------------------------ validation */

const t = testT("vi");

describe("validateSignupInput", () => {
  it("accepts a well-formed form, trims the email, and keeps the password exactly as typed", () => {
    const password = "  Pa55 word!!  ";
    expect(validateSignupInput("  bob@example.test \n", password, password)).toEqual({
      ok: true,
      credentials: { email: "bob@example.test", password },
    });
  });

  it.each([
    ["", PASSWORD, PASSWORD, "email", "customer.auth.validation.emailRequired"],
    ["   ", PASSWORD, PASSWORD, "email", "customer.auth.validation.emailRequired"],
    ["not-an-email", PASSWORD, PASSWORD, "email", "customer.auth.validation.emailInvalid"],
    ["a@b@c", PASSWORD, PASSWORD, "email", "customer.auth.validation.emailInvalid"],
    [`${"a".repeat(250)}@x.test`, PASSWORD, PASSWORD, "email", "customer.auth.validation.emailTooLong"],
    ["bob@example.test", "", "", "password", "customer.auth.validation.passwordRequired"],
    ["bob@example.test", " ".repeat(14), " ".repeat(14), "password", "customer.auth.validation.passwordRequired"],
    ["bob@example.test", "Aa1!aaaaaaa", "Aa1!aaaaaaa", "password", "customer.signup.validation.passwordMin"],
    ["bob@example.test", `Aa1!${"a".repeat(125)}`, `Aa1!${"a".repeat(125)}`, "password", "customer.auth.validation.passwordTooLong"],
    ["bob@example.test", PASSWORD, "", "confirmation", "customer.signup.validation.confirmationRequired"],
    ["bob@example.test", PASSWORD, `${PASSWORD} `, "confirmation", "customer.signup.validation.confirmationMismatch"],
    ["bob@example.test", PASSWORD, "aa1!AAAAAAAA", "confirmation", "customer.signup.validation.confirmationMismatch"],
  ])("refuses %j / password %j / confirmation %j (focus %s)", (email, password, confirmation, focus, message) => {
    const result = validateSignupInput(email, password, confirmation);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.focus).toBe(focus);
    expect(Object.values(result.errors)).toContain(message);
  });

  it("is exact at the length limits: 12 and 128 characters pass, 11 and 129 do not", () => {
    const at = (length: number) => `Aa1!${"a".repeat(length - 4)}`;
    for (const length of [12, 128]) {
      expect(validateSignupInput("bob@example.test", at(length), at(length)).ok).toBe(true);
    }
    for (const length of [11, 129]) {
      expect(validateSignupInput("bob@example.test", at(length), at(length)).ok).toBe(false);
    }
  });

  it("does not decide the character classes: a long password without them is left to the server", () => {
    const flat = "a".repeat(20);
    expect(validateSignupInput("bob@example.test", flat, flat).ok).toBe(true);
  });

  it("counts length like .NET does (UTF-16 code units) and never normalises", () => {
    const decomposed = "é".repeat(6); // 12 code units, 6 visible characters
    expect(validateSignupInput("bob@example.test", decomposed, decomposed)).toMatchObject({ ok: true });
    expect(validateSignupInput("bob@example.test", decomposed, decomposed.normalize("NFC"))).toMatchObject({
      ok: false,
      focus: "confirmation",
    });
  });

  it("focuses the first wrong field in page order and reports every wrong field", () => {
    const result = validateSignupInput("nope", "short", "other");
    expect(result).toMatchObject({ ok: false, focus: "email" });
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["confirmation", "email", "password"]);
  });
});

/* ------------------------------------------------------------------ outcome and wording */

describe("signupOutcomeOf", () => {
  it.each([
    [http(400), "invalid"],
    [new ApiValidationError(400, { title: "x", status: 400, errors: { Password: ["SECRET-FIELD"] } }), "invalid"],
    [http(409), "exists"],
    [http(429), "rate-limited"],
  ])("%# is a documented refusal", (error, expected) => {
    expect(signupOutcomeOf(error)).toBe(expected);
  });

  it.each([
    ["408", http(408)],
    ["500", http(500)],
    ["502", http(502)],
    ["503", http(503)],
    ["504", http(504)],
    ["401", http(401)],
    ["404", http(404)],
    ["418", http(418)],
    ["network loss", new ApiNetworkError()],
    ["malformed success", new Error("anything")],
  ])("%s may have followed a created account, so it is uncertain", (_name, error) => {
    expect(signupOutcomeOf(error)).toBe("uncertain");
  });
});

describe("presentSignupOutcome", () => {
  const outcomes: SignupOutcome[] = ["created", "invalid", "exists", "rate-limited", "uncertain"];

  it("says created and not signed in only when the provider has verified an anonymous session; link carries nothing", () => {
    const view = presentSignupOutcome("created", "anonymous", t);
    expect(view.message).toBe("Tạo tài khoản thành công. Bạn chưa đăng nhập.");
    expect(view.link).toEqual({ href: "/login", label: "Đăng nhập" });
  });

  it("does not claim 'not signed in' when the provider says the customer is signed in", () => {
    const message = presentSignupOutcome("created", "authenticated", t).message;
    expect(message).toBe("Tạo tài khoản thành công. Việc đăng ký không thay đổi phiên đăng nhập hiện tại.");
    expect(message).not.toContain("chưa đăng nhập");
  });

  it.each<CustomerSessionState["status"]>(["unknown", "loading"])(
    "says nothing about the current session while the provider does not know it (%s)",
    (status) => {
      const view = presentSignupOutcome("created", status, t);
      expect(view.message).toBe("Tạo tài khoản thành công. Việc đăng ký không tự đăng nhập.");
      expect(view.message).not.toContain("chưa đăng nhập");
      expect(view.message).not.toContain("hiện tại");
      expect(view.outcome).toBe("created");
      expect(view.link).toEqual({ href: "/login", label: "Đăng nhập" });
    }
  );

  it("keeps the account outcome while the session knowledge changes (same created result, re-presented per status)", () => {
    const statuses: CustomerSessionState["status"][] = ["unknown", "anonymous", "unknown", "authenticated", "loading"];
    const views = statuses.map((status) => presentSignupOutcome("created", status, t));
    expect(views.every((view) => view.outcome === "created" && view.tone === "success")).toBe(true);
    expect(views.map((view) => view.message)).toEqual([
      "Tạo tài khoản thành công. Việc đăng ký không tự đăng nhập.",
      "Tạo tài khoản thành công. Bạn chưa đăng nhập.",
      "Tạo tài khoản thành công. Việc đăng ký không tự đăng nhập.",
      "Tạo tài khoản thành công. Việc đăng ký không thay đổi phiên đăng nhập hiện tại.",
      "Tạo tài khoản thành công. Việc đăng ký không tự đăng nhập.",
    ]);
  });

  it.each<CustomerSessionState["status"]>(["loading", "anonymous", "authenticated", "unknown"])(
    "never changes a failure outcome's wording with the session status (%s)",
    (status) => {
      for (const outcome of ["invalid", "exists", "rate-limited", "uncertain"] as const) {
        expect(presentSignupOutcome(outcome, status, t)).toEqual(presentSignupOutcome(outcome, "anonymous", t));
      }
    }
  );

  it("calls only 201 a success", () => {
    expect(outcomes.filter((outcome) => presentSignupOutcome(outcome, "anonymous", t).tone === "success")).toEqual(["created"]);
  });

  it("never says an uncertain attempt did or did not create the account, and offers login", () => {
    const view = presentSignupOutcome("uncertain", "anonymous", t);
    expect(view.message).toContain("Chưa xác nhận được tài khoản đã được tạo hay chưa");
    expect(view.message).not.toMatch(/thành công|không được tạo|chưa được tạo/);
    expect(view.link?.href).toBe("/login");
  });

  it("does not turn a conflict into ownership or success, and does not invent a wait time", () => {
    expect(presentSignupOutcome("exists", "anonymous", t).message).not.toMatch(/thành công|đã tạo/);
    expect(presentSignupOutcome("rate-limited", "anonymous", t).message).not.toMatch(/\d/);
  });

  it("lists the password requirements for a refused (400) request", () => {
    expect(presentSignupOutcome("invalid", "anonymous", t).message).toContain(t("customer.signup.passwordRequirements", { min: PASSWORD_MIN_LENGTH }));
  });

  it("shows nothing but its own wording: no server text, no credentials", () => {
    for (const outcome of outcomes) {
      const text = JSON.stringify(presentSignupOutcome(outcome, "anonymous", t));
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain("bob@example.test");
    }
  });
});

/* ------------------------------------------------------------------ one attempt at a time */

describe("createSignupOwner", () => {
  it("sends one registration with exactly the credentials and delivers a created outcome", async () => {
    const register = vi.fn().mockResolvedValue({ customerAccountId: "x", email: "bob@example.test" });
    const onSettled = vi.fn();
    const owner = createSignupOwner(register);

    expect(owner.submit(credentials, onSettled)).toBe(true);
    expect(owner.isBusy()).toBe(true);
    await settle();

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(credentials);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith("created");
    expect(owner.isBusy()).toBe(false);
  });

  it("starts one registration for two events in the same tick", async () => {
    const pending = deferred<unknown>();
    const register = vi.fn().mockReturnValue(pending.promise);
    const onSettled = vi.fn();
    const owner = createSignupOwner(register);

    const first = owner.submit(credentials, onSettled);
    const second = owner.submit(credentials, onSettled);

    expect([first, second]).toEqual([true, false]);
    expect(register).toHaveBeenCalledTimes(1);
    pending.resolve({});
    await settle();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("accepts a new attempt only after the previous one has settled", async () => {
    const register = vi.fn().mockRejectedValueOnce(http(409)).mockResolvedValueOnce({});
    const outcomes: SignupOutcome[] = [];
    const owner = createSignupOwner(register);

    owner.submit(credentials, (outcome) => outcomes.push(outcome));
    await settle();
    owner.submit(credentials, (outcome) => outcomes.push(outcome));
    await settle();

    expect(outcomes).toEqual(["exists", "created"]);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("delivers nothing after dispose, and refuses new attempts", async () => {
    const pending = deferred<unknown>();
    const register = vi.fn().mockReturnValue(pending.promise);
    const onSettled = vi.fn();
    const owner = createSignupOwner(register);

    owner.submit(credentials, onSettled);
    owner.dispose();
    pending.resolve({});
    await settle();

    expect(onSettled).not.toHaveBeenCalled();
    expect(owner.submit(credentials, onSettled)).toBe(false);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("drops a late failure after dispose too", async () => {
    const pending = deferred<unknown>();
    const onSettled = vi.fn();
    const owner = createSignupOwner(() => pending.promise);

    owner.submit(credentials, onSettled);
    owner.dispose();
    pending.reject(http(500));
    await settle();

    expect(onSettled).not.toHaveBeenCalled();
  });

  it("treats a register call that throws synchronously as an uncertain outcome", async () => {
    const onSettled = vi.fn();
    const owner = createSignupOwner(() => {
      throw new Error("config");
    });
    expect(owner.submit(credentials, onSettled)).toBe(true);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith("uncertain");
    expect(owner.isBusy()).toBe(false);
  });

  it("does not turn a conflict after a lost attempt into a success", async () => {
    const register = vi.fn().mockRejectedValueOnce(new ApiNetworkError()).mockRejectedValueOnce(http(409));
    const outcomes: SignupOutcome[] = [];
    const owner = createSignupOwner(register);

    owner.submit(credentials, (outcome) => outcomes.push(outcome));
    await settle();
    owner.submit(credentials, (outcome) => outcomes.push(outcome));
    await settle();

    expect(outcomes).toEqual(["uncertain", "exists"]);
    expect(outcomes).not.toContain("created");
  });
});

/* ------------------------------------------------------------------ with the real register call */

vi.mock("@/lib/api/httpClient", () => ({
  apiGet: vi.fn(),
  apiUnsafeRequest: vi.fn(),
}));
vi.mock("@/lib/api/csrf", () => ({
  invalidateCsrfToken: vi.fn(),
  submitCsrfProtectedRequest: vi.fn(),
}));

describe("the owner with the real registerCustomer", () => {
  const GOOD = { customerAccountId: "6f0f7c39-4a58-4a1c-9d2a-0d2d5b0d8f10", email: "bob@example.test" };

  async function run(respond: () => Promise<unknown>): Promise<SignupOutcome> {
    const { apiUnsafeRequest, apiGet } = await import("@/lib/api/httpClient");
    const { invalidateCsrfToken, submitCsrfProtectedRequest } = await import("@/lib/api/csrf");
    vi.mocked(apiUnsafeRequest).mockReset().mockImplementation(respond as never);
    vi.mocked(apiGet).mockReset();
    vi.mocked(invalidateCsrfToken).mockReset();
    vi.mocked(submitCsrfProtectedRequest).mockReset();

    const owner = createSignupOwner((creds) => registerCustomer(creds));
    const outcome = await new Promise<SignupOutcome>((resolve) => owner.submit(credentials, resolve));

    // One POST to register with the untouched body; nothing else was called: no login, no `me`, no CSRF.
    expect(vi.mocked(apiUnsafeRequest)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiUnsafeRequest).mock.calls[0].slice(0, 3)).toEqual([
      "/api/v1/auth/register",
      "POST",
      { email: credentials.email, password: credentials.password },
    ]);
    expect(vi.mocked(apiGet)).not.toHaveBeenCalled();
    expect(vi.mocked(invalidateCsrfToken)).not.toHaveBeenCalled();
    expect(vi.mocked(submitCsrfProtectedRequest)).not.toHaveBeenCalled();
    return outcome;
  }

  it("201 with an identity is created", async () => {
    expect(await run(async () => ({ status: 201, data: GOOD }))).toBe("created");
  });

  it.each([
    ["200 instead of 201", { status: 200, data: GOOD }],
    ["201 without a body", { status: 201, data: undefined }],
    ["201 with an empty id", { status: 201, data: { ...GOOD, customerAccountId: "00000000-0000-0000-0000-000000000000" } }],
    ["201 with an empty email", { status: 201, data: { ...GOOD, email: " " } }],
  ])("%s is uncertain, not created", async (_name, response) => {
    expect(await run(async () => response)).toBe("uncertain");
  });

  it.each([
    [400, "invalid"],
    [409, "exists"],
    [429, "rate-limited"],
    [500, "uncertain"],
    [503, "uncertain"],
    [408, "uncertain"],
  ])("HTTP %i is %s", async (status, expected) => {
    expect(await run(async () => Promise.reject(http(status)))).toBe(expected);
  });

  it("a lost connection is uncertain", async () => {
    expect(await run(async () => Promise.reject(new ApiNetworkError()))).toBe("uncertain");
  });
});
