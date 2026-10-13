"use client";

import React, { FC, FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { AuthPresentationView, CustomerSessionNotice, useAuthCommand } from "@/components/CustomerAuthNotice";
import { ACCOUNT_PAGE, HOME_PAGE, LoginFieldErrors, EMAIL_MAX_LENGTH, loginSucceeded, validateLoginInput } from "@/lib/customerAuthUi";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";
import Input from "@/shared/Input";

const HEADING_CLASS =
  "my-20 flex items-center text-3xl leading-[115%] md:text-5xl md:leading-[115%] font-semibold text-neutral-900 dark:text-neutral-100 justify-center";
const ERROR_CLASS = "mt-1 text-sm text-red-600 dark:text-red-400";

/**
 * CUST-WEB-001-CP02. The login form and, for a signed-in Customer, the session panel. The only things it
 * calls on the provider are `guardedLogin` / `guardedLogout`; who the Customer is comes from the provider's
 * `me` state alone. Credentials live in the (uncontrolled) inputs and in one local variable for the single
 * call: never in state, a URL, storage or a log, and the password field is emptied once the attempt ends.
 *
 * This component owns the attempt for as long as it is mounted — it must not be split so that the part
 * holding the owner is shown only for some `me` states: the provider reports `loading` during an attempt.
 */
const LoginForm: FC = () => {
  const router = useRouter();
  const { state, identityChange, guardedLogin, guardedLogout } = useCustomerSession();
  const login = useAuthCommand("login");
  const logout = useAuthCommand("logout");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [redirecting, setRedirecting] = useState(false);

  const clearPassword = () => {
    if (passwordRef.current) passwordRef.current.value = "";
  };

  // A password never outlives the identity it was typed under.
  const accountId = state.customer?.customerAccountId ?? null;
  useEffect(() => {
    clearPassword();
  }, [accountId]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateLoginInput(emailRef.current?.value ?? "", passwordRef.current?.value ?? "");
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      (validation.focus === "email" ? emailRef : passwordRef).current?.focus();
      return;
    }
    setFieldErrors({});
    const { credentials } = validation;
    const started = login.run(
      () => guardedLogin(credentials),
      (result) => {
        clearPassword();
        // Leave the page only for the attempt of this very mount, and only when it succeeded AND `me` agrees.
        if (loginSucceeded(result)) {
          setRedirecting(true);
          router.push(HOME_PAGE);
        }
      }
    );
    if (started) logout.reset();
  };

  const onLogout = () => {
    if (logout.run(() => guardedLogout())) login.reset();
  };

  // The server render and the very first client render know nothing yet: show no form (and no password
  // field) until the session has been read, or an attempt of this page is under way.
  const checking = state.status === "loading" && identityChange.phase === "idle" && !login.busy && !logout.busy;
  const authenticated = state.status === "authenticated";
  const busy = login.busy || logout.busy;
  const working = login.working || logout.working;
  const emailError = fieldErrors.email;
  const passwordError = fieldErrors.password;

  const renderForm = () => (
    <form className="grid grid-cols-1 gap-6" method="post" noValidate onSubmit={onSubmit} aria-busy={busy}>
      <div className="block">
        <label htmlFor="login-email" className="block text-neutral-800 dark:text-neutral-200">
          Địa chỉ email
        </label>
        <Input
          id="login-email"
          name="email"
          ref={emailRef}
          type="email"
          inputMode="email"
          required
          maxLength={EMAIL_MAX_LENGTH}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={busy}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "login-email-error" : undefined}
          placeholder="ten@example.com"
          className="mt-1"
        />
        {emailError && (
          <p id="login-email-error" role="alert" className={ERROR_CLASS}>
            {emailError}
          </p>
        )}
      </div>
      <div className="block">
        <label htmlFor="login-password" className="block text-neutral-800 dark:text-neutral-200">
          Mật khẩu
        </label>
        <Input
          id="login-password"
          name="password"
          ref={passwordRef}
          type="password"
          required
          autoComplete="current-password"
          readOnly={busy}
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? "login-password-error" : undefined}
          className="mt-1"
        />
        {passwordError && (
          <p id="login-password-error" role="alert" className={ERROR_CLASS}>
            {passwordError}
          </p>
        )}
      </div>
      <ButtonPrimary type="submit" loading={working} disabled={busy}>
        Đăng nhập
      </ButtonPrimary>
    </form>
  );

  const renderPanel = (email: string) => (
    <section aria-label="Phiên đăng nhập" className="space-y-4 rounded-2xl border border-neutral-200 p-6 dark:border-neutral-700">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">Bạn đang đăng nhập bằng</p>
      <p className="break-all text-lg font-semibold text-neutral-900 dark:text-neutral-100">{email}</p>
      <div className="flex flex-wrap gap-3">
        <ButtonPrimary type="button" loading={logout.working} disabled={busy} onClick={onLogout}>
          Đăng xuất
        </ButtonPrimary>
        <ButtonSecondary href={ACCOUNT_PAGE as Route}>Xem tài khoản</ButtonSecondary>
        <ButtonSecondary href={HOME_PAGE}>Về trang chủ</ButtonSecondary>
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Hiện chỉ xem được email tài khoản; chỉnh sửa hồ sơ và lịch sử đặt phòng chưa được hỗ trợ.
      </p>
    </section>
  );

  return (
    <>
      <h2 className={HEADING_CLASS}>{authenticated ? "Tài khoản" : "Đăng nhập"}</h2>
      <div className="max-w-md mx-auto space-y-6">
        <CustomerSessionNotice />
        <AuthPresentationView presentation={login.presentation} />
        <AuthPresentationView presentation={logout.presentation} />
        {redirecting ? (
          <p role="status" className="text-sm text-neutral-600 dark:text-neutral-300">
            Đang chuyển về trang chủ…
          </p>
        ) : checking ? null : logout.pending ? (
          <p role="status" className="text-sm text-neutral-600 dark:text-neutral-300">
            Đang đăng xuất…
          </p>
        ) : authenticated && state.customer ? (
          renderPanel(state.customer.email)
        ) : (
          renderForm()
        )}
        {!checking && !authenticated && (
          <p className="block text-center text-sm text-neutral-600 dark:text-neutral-400">
            Bạn có thể đặt phòng mà không cần tài khoản. Chưa có tài khoản?{" "}
            <Link href={"/signup" as Route} className="font-semibold underline">
              Tạo tài khoản
            </Link>
          </p>
        )}
      </div>
    </>
  );
};

export default LoginForm;
