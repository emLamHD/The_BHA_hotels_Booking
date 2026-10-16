"use client";

import React, { FC, FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { CustomerSessionNotice } from "@/components/CustomerAuthNotice";
import { registerCustomer } from "@/lib/api/authService";
import { ACCOUNT_PAGE, EMAIL_MAX_LENGTH, LOGIN_PAGE, PASSWORD_MAX_LENGTH } from "@/lib/customerAuthUi";
import {
  PASSWORD_MIN_LENGTH,
  SignupFieldErrors,
  SignupOutcome,
  SignupOwner,
  createSignupOwner,
  presentSignupOutcome,
  validateSignupInput,
} from "@/lib/customerSignupUi";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";
import Input from "@/shared/Input";

import { useT } from "@/lib/i18n/I18nProvider";
const HEADING_CLASS =
  "my-20 flex items-center text-3xl leading-[115%] md:text-5xl md:leading-[115%] font-semibold text-neutral-900 dark:text-neutral-100 justify-center";
const ERROR_CLASS = "mt-1 text-sm text-red-600 dark:text-red-400";
const HINT_CLASS = "mt-1 text-xs text-neutral-500 dark:text-neutral-400";
const TONE_CLASS = {
  success: "text-green-700 dark:text-green-400",
  error: "text-red-600 dark:text-red-400",
  warning: "text-amber-700 dark:text-amber-400",
} as const;

/**
 * CUST-WEB-001-CP03. The signup form. Registering creates an account and does not sign anyone in, so this
 * component never changes the session: it only reads the provider's `me` state (to show the form, the
 * signed-in panel or a notice) and makes one `registerCustomer` call per attempt, through an owner that
 * claims the attempt synchronously and drops a late answer once the page is gone. The passwords live in the
 * (uncontrolled) inputs and in one local variable for the call — never in state, a URL, storage or a log —
 * and both fields are emptied when an attempt ends (the inputs themselves are removed with the page).
 */
const SignupForm: FC = () => {
  const t = useT();
  const { state, identityChange } = useCustomerSession();
  const ownerRef = useRef<SignupOwner | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [outcome, setOutcome] = useState<SignupOutcome | null>(null);
  const [pending, setPending] = useState(false);

  const clearPasswords = () => {
    if (passwordRef.current) passwordRef.current.value = "";
    if (confirmationRef.current) confirmationRef.current.value = "";
  };

  useEffect(() => {
    const owner = createSignupOwner((credentials) => registerCustomer(credentials));
    ownerRef.current = owner;
    return () => {
      owner.dispose();
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const owner = ownerRef.current;
    if (!owner || identityChange.phase !== "idle") return;
    const validation = validateSignupInput(
      emailRef.current?.value ?? "",
      passwordRef.current?.value ?? "",
      confirmationRef.current?.value ?? ""
    );
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      const target = { email: emailRef, password: passwordRef, confirmation: confirmationRef }[validation.focus];
      target.current?.focus();
      return;
    }
    setFieldErrors({});
    const started = owner.submit(validation.credentials, (result) => {
      setPending(false);
      setOutcome(result);
      clearPasswords();
    });
    if (started) {
      setPending(true);
      setOutcome(null);
    }
  };

  const authenticated = state.status === "authenticated";
  const identityBusy = identityChange.phase !== "idle";
  // The server render and the very first client render know nothing yet: show no form (and no password
  // field) until the session has been read, or an attempt of this page is under way.
  const checking = state.status === "loading" && !identityBusy && !pending;
  const blocked = identityBusy;
  const presentation = outcome ? presentSignupOutcome(outcome, state.status, t) : null;
  const created = outcome === "created";
  const emailError = fieldErrors.email;
  const passwordError = fieldErrors.password;
  const confirmationError = fieldErrors.confirmation;

  const renderForm = () => (
    <form className="grid grid-cols-1 gap-6" method="post" noValidate onSubmit={onSubmit} aria-busy={pending}>
      <div className="block">
        <label htmlFor="signup-email" className="block text-neutral-800 dark:text-neutral-200">{t("customer.common.emailAddress")}</label>
        <Input
          id="signup-email"
          name="email"
          ref={emailRef}
          type="email"
          inputMode="email"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={pending || blocked}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "signup-email-error" : undefined}
          placeholder={t("customer.common.tenExampleCom")}
          className="mt-1"
        />
        {emailError && (
          <p id="signup-email-error" role="alert" className={ERROR_CLASS}>
            {t(emailError, { max: EMAIL_MAX_LENGTH })}
          </p>
        )}
      </div>
      <div className="block">
        <label htmlFor="signup-password" className="block text-neutral-800 dark:text-neutral-200">{t("customer.common.password")}</label>
        <Input
          id="signup-password"
          name="password"
          ref={passwordRef}
          type="password"
          required
          autoComplete="new-password"
          readOnly={pending || blocked}
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? "signup-password-hint signup-password-error" : "signup-password-hint"}
          className="mt-1"
        />
        <p id="signup-password-hint" className={HINT_CLASS}>
          {t("customer.signup.passwordRequirements", { min: PASSWORD_MIN_LENGTH })}
        </p>
        {passwordError && (
          <p id="signup-password-error" role="alert" className={ERROR_CLASS}>
            {t(passwordError, { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })}
          </p>
        )}
      </div>
      <div className="block">
        <label htmlFor="signup-confirmation" className="block text-neutral-800 dark:text-neutral-200">{t("customer.signup.signupForm.confirmPassword")}</label>
        <Input
          id="signup-confirmation"
          name="confirmPassword"
          ref={confirmationRef}
          type="password"
          required
          autoComplete="new-password"
          readOnly={pending || blocked}
          aria-invalid={confirmationError ? true : undefined}
          aria-describedby={confirmationError ? "signup-confirmation-error" : undefined}
          className="mt-1"
        />
        {confirmationError && (
          <p id="signup-confirmation-error" role="alert" className={ERROR_CLASS}>
            {t(confirmationError)}
          </p>
        )}
      </div>
      <ButtonPrimary type="submit" loading={pending} disabled={pending || blocked}>{t("customer.common.createAnAccount")}</ButtonPrimary>
    </form>
  );

  const renderSigned = (email: string) => (
    <section aria-label={t("customer.common.session")} className="space-y-4 rounded-2xl border border-neutral-200 p-6 dark:border-neutral-700">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("customer.common.youAreSignedInAs")}</p>
      <p className="break-all text-lg font-semibold text-neutral-900 dark:text-neutral-100">{email}</p>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{t("customer.signup.signupForm.toCreateADifferentAccount")}</p>
      <div className="flex flex-wrap gap-3">
        <ButtonPrimary href={ACCOUNT_PAGE as Route}>{t("customer.signup.signupForm.goToYourAccount")}</ButtonPrimary>
        <ButtonSecondary href="/">{t("customer.common.backToHome2")}</ButtonSecondary>
      </div>
    </section>
  );

  const renderCreated = () => (
    <section aria-label={t("customer.signup.signupForm.signUpResult")} className="space-y-4 rounded-2xl border border-neutral-200 p-6 dark:border-neutral-700">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{t("customer.signup.signupForm.signInWithTheEmail")}</p>
      <ButtonPrimary href={LOGIN_PAGE as Route}>{t("customer.common.signIn")}</ButtonPrimary>
    </section>
  );

  return (
    <>
      <h2 className={HEADING_CLASS}>{t("customer.common.createAnAccount")}</h2>
      <div className="max-w-md mx-auto space-y-6">
        <CustomerSessionNotice />
        {presentation && (
          <div role={presentation.tone === "success" ? "status" : "alert"} className={`text-sm ${TONE_CLASS[presentation.tone]}`}>
            <p>{presentation.message}</p>
            {presentation.link && !created && (
              <p className="mt-1">
                <Link href={presentation.link.href as Route} className="font-medium underline underline-offset-2">
                  {presentation.link.label}
                </Link>
              </p>
            )}
          </div>
        )}
        {checking ? null : authenticated && state.customer ? (
          renderSigned(state.customer.email)
        ) : created ? (
          renderCreated()
        ) : (
          renderForm()
        )}
        {!checking && !authenticated && !created && (
          <p className="block text-center text-sm text-neutral-600 dark:text-neutral-400">{t("customer.signup.signupForm.alreadyHaveAnAccount")}{" "}
            <Link href={LOGIN_PAGE as Route} className="font-semibold underline">{t("customer.common.signIn")}</Link>
          </p>
        )}
      </div>
    </>
  );
};

export default SignupForm;
