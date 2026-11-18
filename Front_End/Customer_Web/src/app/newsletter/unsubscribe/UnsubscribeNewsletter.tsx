"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { FC, useEffect, useRef, useState } from "react";
import { CheckIcon, EnvelopeIcon, ExclamationCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { unsubscribeNewsletter, type NewsletterUnsubscribeResult } from "@/lib/newsletterApi";
import { confirmUrlWithoutFragment, NEWSLETTER_UNSUBSCRIBE, parseConfirmFragment } from "@/lib/newsletterUi";
import { useT } from "@/lib/i18n/I18nProvider";

type Phase = "ready" | "working" | NewsletterUnsubscribeResult["kind"] | "missing";

const RESULT_MESSAGE: Record<NewsletterUnsubscribeResult["kind"], string> = {
  unsubscribed: NEWSLETTER_UNSUBSCRIBE.done,
  already: NEWSLETTER_UNSUBSCRIBE.already,
  invalid: NEWSLETTER_UNSUBSCRIBE.invalid,
  failed: NEWSLETTER_UNSUBSCRIBE.failed,
};

/**
 * BHA-NEWSLETTER-003. Same discipline as the confirmation page: the token is in the URL FRAGMENT (`#t=…`), read once, removed from the address bar through the
 * App Router, and sent in a POST body only when the visitor presses the button, so a mail scanner or a link preview that merely opens the page cannot unsubscribe
 * anyone. Nothing is retried; a failure can be pressed again.
 */
const UnsubscribeNewsletter: FC = () => {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const token = useRef<string | null>(null);
  const inFlight = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    // Once: the fragment is gone after the first run, so a second run must not read "no token" over the real one.
    if (started.current) return;
    started.current = true;
    token.current = parseConfirmFragment(window.location.hash);
    if (token.current === null) setPhase("missing");
    router.replace(confirmUrlWithoutFragment(window.location.pathname, window.location.search) as never);
  }, [router]);

  const unsubscribe = async () => {
    if (inFlight.current || token.current === null) return;
    inFlight.current = true;
    setPhase("working");
    const result = await unsubscribeNewsletter(token.current);
    inFlight.current = false;
    setPhase(result.kind);
  };

  const finished = phase !== "ready" && phase !== "working";
  const retryable = phase === "failed";
  const good = phase === "unsubscribed" || phase === "already";
  const message = phase === "missing" ? NEWSLETTER_UNSUBSCRIBE.invalid : finished ? RESULT_MESSAGE[phase] : null;
  // Presentation only: one decorative badge per state; the text below carries the meaning.
  const Icon = good ? CheckIcon : phase === "failed" ? ExclamationTriangleIcon : phase === "invalid" || phase === "missing" ? ExclamationCircleIcon : EnvelopeIcon;
  const tone = good
    ? "bg-green-100 text-green-600 ring-green-50 dark:bg-green-900/40 dark:text-green-400 dark:ring-green-900/20"
    : finished
      ? "bg-red-100 text-red-600 ring-red-50 dark:bg-red-900/40 dark:text-red-400 dark:ring-red-900/20"
      : "bg-primary-100 text-primary-6000 ring-primary-50 dark:bg-primary-900/40 dark:text-primary-300 dark:ring-primary-900/20";

  return (
    <div className="relative mx-auto max-w-xl py-10 sm:py-16">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 mx-auto h-64 max-w-md rounded-full bg-primary-200/50 blur-3xl dark:bg-primary-900/30" />
      <section
        aria-labelledby="newsletter-unsubscribe-heading"
        className="relative overflow-hidden rounded-3xl border border-neutral-200 bg-white text-center shadow-xl shadow-primary-900/5 dark:border-neutral-700 dark:bg-neutral-900"
      >
        <div aria-hidden className="h-1.5 w-full bg-gradient-to-r from-primary-400 via-primary-6000 to-primary-800" />
        <div className="px-6 pb-10 pt-10 sm:px-12 sm:pb-12 sm:pt-12">
          <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full ring-8 transition-colors ${tone}`}>
            <Icon aria-hidden className={`h-9 w-9 ${phase === "working" ? "motion-safe:animate-pulse" : ""}`} strokeWidth={1.75} />
          </div>
          <h1 id="newsletter-unsubscribe-heading" className="mt-7 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">{t(NEWSLETTER_UNSUBSCRIBE.heading)}</h1>
          {!finished || retryable ? <p className="mx-auto mt-3 max-w-md leading-7 text-neutral-600 dark:text-neutral-300">{t(NEWSLETTER_UNSUBSCRIBE.intro)}</p> : null}
          <div aria-live="polite" className="mt-6 min-h-[1.5rem]">
            {message ? (
              <p role={good ? "status" : "alert"} className={`mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium leading-6 ${good ? "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"}`}>
                {t(message)}
              </p>
            ) : null}
          </div>
          {phase === "ready" || phase === "working" || retryable ? (
            <button
              type="button"
              onClick={() => void unsubscribe()}
              disabled={phase === "working"}
              aria-busy={phase === "working" || undefined}
              className="mt-6 inline-flex h-14 w-full items-center justify-center rounded-full bg-primary-6000 px-10 text-base font-semibold text-white shadow-lg shadow-primary-6000/30 transition motion-safe:hover:-translate-y-0.5 hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 sm:w-auto"
            >
              {t(phase === "working" ? NEWSLETTER_UNSUBSCRIBE.working : NEWSLETTER_UNSUBSCRIBE.button)}
            </button>
          ) : (
            <Link href="/" className="mt-6 inline-flex h-14 w-full items-center justify-center rounded-full border border-neutral-200 px-10 text-base font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800 sm:w-auto">
              {t(NEWSLETTER_UNSUBSCRIBE.home)}
            </Link>
          )}
        </div>
      </section>
    </div>
  );
};

export default UnsubscribeNewsletter;
