"use client";

import React, { FC, FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRightIcon, EnvelopeIcon } from "@heroicons/react/24/solid";
import {
  NEWSLETTER_BENEFIT,
  NEWSLETTER_DISCLOSURE,
  NEWSLETTER_HEADING,
  NEWSLETTER_NOT_STORED_MESSAGE,
  validateNewsletterEmail,
} from "@/lib/newsletterUi";

import { useT } from "@/lib/i18n/I18nProvider";
type Feedback = { kind: "error" | "notice"; message: string; id: number } | null;

/**
 * CUST-WEB-001-CP08a-C2: the newsletter box as a UI preview (`NEWSLETTER: UI_PREVIEW_VALIDATED_NOT_PERSISTED`).
 * The address is checked by `validateNewsletterEmail` and nothing else happens: no request, no storage, no
 * mailto, no tracking, no query string, no reload, and the field is emptied once the check passes so the
 * address is not kept anywhere. The input has no `name` and the form no action, so even a submit before the
 * page is interactive carries no address. The disclosure is visible before the visitor submits.
 */
const HomeNewsletter: FC = () => {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const attempts = useRef(0);

  // An invalid address returns focus to the field, so the error is read where the fix is made.
  useEffect(() => {
    if (feedback?.kind === "error") inputRef.current?.focus();
  }, [feedback]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = inputRef.current;
    const result = validateNewsletterEmail(field?.value ?? "");
    attempts.current += 1;
    if (!result.ok) {
      setFeedback({ kind: "error", message: result.message, id: attempts.current });
      return;
    }
    if (field) field.value = "";
    setFeedback({ kind: "notice", message: NEWSLETTER_NOT_STORED_MESSAGE, id: attempts.current });
  };

  return (
    <section
      aria-labelledby="newsletter-heading"
      className="nc-HomeNewsletter relative overflow-hidden rounded-3xl border border-primary-100 bg-gradient-to-br from-primary-50 via-white to-primary-100/60 px-6 py-10 dark:border-neutral-700 dark:from-neutral-800 dark:via-neutral-800 dark:to-neutral-900 sm:px-10 sm:py-12 lg:px-14 lg:py-14"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary-200/40 blur-2xl dark:bg-primary-500/10" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-primary-100/70 blur-2xl dark:bg-primary-500/10" />
      <div className="relative grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
        <div className="space-y-4">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-primary-6000 shadow-sm dark:bg-neutral-900 dark:text-primary-300">
            <EnvelopeIcon className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 id="newsletter-heading" className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50 sm:text-3xl">
            {NEWSLETTER_HEADING}
          </h2>
          <p className="max-w-md text-neutral-600 dark:text-neutral-300">{NEWSLETTER_BENEFIT}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-lg shadow-primary-900/5 dark:bg-neutral-900 sm:p-6">
          <form noValidate onSubmit={onSubmit} aria-describedby="newsletter-disclosure" className="space-y-3">
            <label htmlFor="newsletter-email" className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("customer.home.homeNewsletter.yourEmail")}</label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                ref={inputRef}
                id="newsletter-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t("customer.home.homeNewsletter.tenExampleCom")}
                aria-invalid={feedback?.kind === "error" ? true : undefined}
                aria-describedby={feedback ? "newsletter-feedback" : undefined}
                className="block h-12 w-full min-w-0 flex-1 rounded-full border border-neutral-200 bg-white px-5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring focus:ring-primary-200/50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <button
                type="submit"
                aria-label={t("customer.home.homeNewsletter.subscribeDemoYourEmailIs")}
                className="inline-flex h-12 flex-shrink-0 items-center justify-center gap-2 rounded-full bg-primary-6000 px-6 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >{t("customer.home.homeNewsletter.subscribe")}<ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p id="newsletter-disclosure" className="text-xs text-neutral-700 dark:text-neutral-300">
              {NEWSLETTER_DISCLOSURE}
            </p>
          </form>
          <div aria-live="polite" className="min-h-[1.5rem]">
            {feedback && (
              <p
                key={feedback.id}
                id="newsletter-feedback"
                role={feedback.kind === "error" ? "alert" : "status"}
                className={`mt-2 text-sm font-medium ${feedback.kind === "error" ? "text-red-600 dark:text-red-400" : "text-neutral-800 dark:text-neutral-100"}`}
              >
                {feedback.message}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HomeNewsletter;
