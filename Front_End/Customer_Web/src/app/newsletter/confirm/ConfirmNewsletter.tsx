"use client";

import Link from "next/link";
import React, { FC, useEffect, useRef, useState } from "react";
import { confirmNewsletter, type NewsletterConfirmResult } from "@/lib/newsletterApi";
import { NEWSLETTER_CONFIRM, parseConfirmFragment } from "@/lib/newsletterUi";
import { useT } from "@/lib/i18n/I18nProvider";

type Phase = "ready" | "working" | NewsletterConfirmResult["kind"] | "missing";

const RESULT_MESSAGE: Record<NewsletterConfirmResult["kind"], string> = {
  verified: NEWSLETTER_CONFIRM.verified,
  already: NEWSLETTER_CONFIRM.already,
  expired: NEWSLETTER_CONFIRM.expired,
  invalid: NEWSLETTER_CONFIRM.invalid,
  failed: NEWSLETTER_CONFIRM.failed,
};

/**
 * BHA-NEWSLETTER-002. The token is in the URL FRAGMENT (`#t=…`), which the browser never sends to a server, so it is in no access log
 * and no referrer. It is read once, removed from the address bar, and sent in a POST body only when the visitor presses the button:
 * a mail scanner or a link preview that merely opens the page cannot confirm anything. Nothing is retried; a failure can be pressed again.
 */
const ConfirmNewsletter: FC = () => {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("ready");
  const token = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    token.current = parseConfirmFragment(window.location.hash);
    if (token.current === null) setPhase("missing");
    // Keep the secret out of the address bar, history and any later copy of the URL.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const confirm = async () => {
    if (inFlight.current || token.current === null) return;
    inFlight.current = true;
    setPhase("working");
    const result = await confirmNewsletter(token.current);
    inFlight.current = false;
    setPhase(result.kind);
  };

  const finished = phase !== "ready" && phase !== "working";
  const retryable = phase === "failed";
  const message = phase === "missing" ? NEWSLETTER_CONFIRM.invalid : phase !== "ready" && phase !== "working" ? RESULT_MESSAGE[phase] : null;

  return (
    <section aria-labelledby="newsletter-confirm-heading" className="mx-auto max-w-xl rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-700 dark:bg-neutral-900 sm:p-10">
      <h1 id="newsletter-confirm-heading" className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50 sm:text-3xl">{t(NEWSLETTER_CONFIRM.heading)}</h1>
      {!finished || retryable ? <p className="mt-3 text-neutral-600 dark:text-neutral-300">{t(NEWSLETTER_CONFIRM.intro)}</p> : null}
      <div aria-live="polite" className="mt-6 min-h-[1.5rem]">
        {message ? (
          <p role={phase === "verified" || phase === "already" ? "status" : "alert"} className={`text-sm font-medium ${phase === "verified" || phase === "already" ? "text-neutral-800 dark:text-neutral-100" : "text-red-600 dark:text-red-400"}`}>
            {t(message)}
          </p>
        ) : null}
      </div>
      {phase === "ready" || phase === "working" || retryable ? (
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={phase === "working"}
          aria-busy={phase === "working" || undefined}
          className="mt-4 inline-flex h-12 items-center justify-center rounded-full bg-primary-6000 px-8 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {t(phase === "working" ? NEWSLETTER_CONFIRM.working : NEWSLETTER_CONFIRM.button)}
        </button>
      ) : (
        <Link href="/" className="mt-4 inline-flex h-12 items-center justify-center rounded-full border border-neutral-200 px-8 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800">
          {t(NEWSLETTER_CONFIRM.home)}
        </Link>
      )}
    </section>
  );
};

export default ConfirmNewsletter;
