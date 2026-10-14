"use client";

import React, { FC, FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRightIcon } from "@heroicons/react/24/solid";
import {
  NEWSLETTER_BENEFIT,
  NEWSLETTER_DISCLOSURE,
  NEWSLETTER_HEADING,
  NEWSLETTER_NOT_STORED_MESSAGE,
  validateNewsletterEmail,
} from "@/lib/newsletterUi";

type Feedback = { kind: "error" | "notice"; message: string; id: number } | null;

/**
 * CUST-WEB-001-CP08a-C2: the newsletter box as a UI preview (`NEWSLETTER: UI_PREVIEW_VALIDATED_NOT_PERSISTED`).
 * The address is checked by `validateNewsletterEmail` and nothing else happens: no request, no storage, no
 * mailto, no tracking, no query string, no reload, and the field is emptied once the check passes so the
 * address is not kept anywhere. The input has no `name` and the form no action, so even a submit before the
 * page is interactive carries no address. The disclosure is visible before the visitor submits.
 */
const HomeNewsletter: FC = () => {
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
    <section aria-labelledby="newsletter-heading" className="nc-HomeNewsletter relative overflow-hidden rounded-3xl bg-primary-50 px-6 py-10 dark:bg-neutral-800 sm:px-10 lg:px-14">
      <div className="grid items-center gap-8 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 id="newsletter-heading" className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50 sm:text-3xl">
            {NEWSLETTER_HEADING}
          </h2>
          <p className="text-neutral-600 dark:text-neutral-300">{NEWSLETTER_BENEFIT}</p>
        </div>
        <div>
          <form noValidate onSubmit={onSubmit} aria-describedby="newsletter-disclosure" className="space-y-2">
            <label htmlFor="newsletter-email" className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
              Email của bạn
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="newsletter-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="ten@example.com"
                aria-invalid={feedback?.kind === "error" ? true : undefined}
                aria-describedby={feedback ? "newsletter-feedback" : undefined}
                className="block h-12 w-full rounded-full border border-neutral-200 bg-white pl-5 pr-14 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring focus:ring-primary-200/50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              />
              <button
                type="submit"
                aria-label="Gửi đăng ký (bản demo, email không được lưu)"
                className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-primary-6000 text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                <ArrowRightIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <p id="newsletter-disclosure" className="text-xs text-neutral-500 dark:text-neutral-400">
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
