"use client";

import React, { FC, FormEvent, useEffect, useRef } from "react";
import Input from "@/shared/Input";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";
import ConfirmedPrice from "@/components/ConfirmedPrice";
import UnresolvedDirectAttemptNotice, { useUnresolvedDirectAttempt } from "@/components/UnresolvedDirectAttemptNotice";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { formatAsGiven } from "@/lib/i18n/display";
import { useApiMessage } from "@/lib/i18n/apiMessage";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * BHA-CHECKOUT-001-PR08: the confirmation form of a "pay at the property" booking. Like the Hold panel it renders only
 * from the app-level flow, so leaving the page never aborts a request or loses the retained attempt. The form values
 * stay through every refusal (unavailable, price changed, rooms gone, rate limit); a refusal never turns into a Hold.
 */
const DirectBookingPanel: FC<{ className?: string }> = ({ className = "" }) => {
  const { state, updateContact, submitDirect, retryDirectExact, acceptPriceChange } = useBookingHoldFlow();
  const { state: session, refreshSession } = useCustomerSession();
  const { t, formatLocale } = useI18n();
  const message = useApiMessage();
  const unresolvedMarker = useUnresolvedDirectAttempt();
  const { phase, offer, offerLabel, contact, fieldErrors, errorMessage, priceChange, direct } = state;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    // Headline changes only (a new selection or a resolved outcome), never on a keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, offer?.roomTypeId, offer?.ratePlanId]);

  // An invalid submit moves focus to the first field with an error; the errors are also read out via aria-describedby.
  useEffect(() => {
    if (!fieldErrors) return;
    const first = (["fullName", "email", "phone"] as const).find((field) => fieldErrors[field]);
    if (first) document.getElementById(`direct-${first === "fullName" ? "full-name" : first}`)?.focus();
  }, [fieldErrors]);

  if (!offer) return null;
  const locked = phase === "submitting" || phase === "uncertain";
  const verifying = session.status === "loading" || session.status === "unknown";

  const field = (id: "full-name" | "email" | "phone", prop: "fullName" | "email" | "phone", type: string, auto: string, label: string) => (
    <div>
      <label htmlFor={`direct-${id}`} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
        {label}
      </label>
      <Input
        id={`direct-${id}`}
        type={type}
        autoComplete={auto}
        value={contact[prop]}
        disabled={locked}
        onChange={(event) => updateContact({ ...contact, [prop]: event.target.value })}
        aria-invalid={!!fieldErrors?.[prop]}
        aria-describedby={fieldErrors?.[prop] ? `direct-${id}-error` : undefined}
      />
      {fieldErrors?.[prop] && (
        <p id={`direct-${id}-error`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {message(fieldErrors[prop] as string)}
        </p>
      )}
    </div>
  );

  return (
    <div
      data-testid="direct-booking-panel"
      className={`nc-DirectBookingPanel rounded-3xl border border-neutral-200/80 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 space-y-4 ${className}`}
    >
      <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
        {t("customer.direct.heading")}
      </h3>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{offerLabel}</p>

      <ConfirmedPrice quote={offer.quote} label={t("customer.booking.priceChanged.confirming")} />
      <p data-testid="direct-note" className="text-sm text-neutral-600 dark:text-neutral-300">
        {t("customer.direct.note", { total: formatAsGiven(offer.quote.totalAmount, offer.quote.currencyCode, formatLocale) })}
      </p>

      {priceChange && (
        <div role="alert" data-testid="price-changed" className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="font-medium">{t("customer.booking.priceChanged.title")}</p>
          <p>{t("customer.direct.priceChanged.body")}</p>
          <ConfirmedPrice quote={priceChange} label={t("customer.booking.priceChanged.current")} />
          <ButtonPrimary type="button" onClick={acceptPriceChange}>
            {t("customer.booking.priceChanged.accept")}
          </ButtonPrimary>
        </div>
      )}

      {unresolvedMarker && phase !== "uncertain" && phase !== "submitting" && <UnresolvedDirectAttemptNotice />}

      <div role="status" aria-live="polite" data-testid="direct-owner" className="text-sm text-neutral-600 dark:text-neutral-300">
        {session.status === "authenticated" && t("customer.direct.owner.account", { email: session.customer.email })}
        {session.status === "anonymous" && t("customer.direct.owner.guest")}
        {verifying && (
          <span className="flex flex-wrap items-center gap-3">
            {t("customer.direct.owner.verifying")}
            <ButtonSecondary type="button" onClick={refreshSession} disabled={session.status === "loading"}>
              {t("customer.direct.owner.reverify")}
            </ButtonSecondary>
          </span>
        )}
      </div>

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          submitDirect();
        }}
        noValidate
        className="space-y-4"
      >
        {field("full-name", "fullName", "text", "name", t("customer.booking.hold.fullName"))}
        {field("email", "email", "email", "email", t("customer.booking.hold.email"))}
        {field("phone", "phone", "tel", "tel", t("customer.booking.hold.phone"))}

        {phase === "submitting" && (
          <div role="status" aria-live="polite" className="text-sm text-neutral-500 dark:text-neutral-400">
            {t("customer.direct.confirming")}
          </div>
        )}

        {phase === "known-error" && errorMessage && (
          <div role="alert" data-testid="direct-error" className="text-sm text-red-600 dark:text-red-400">
            {message(errorMessage)}
          </div>
        )}

        {phase === "uncertain" && (
          <div role="alert" data-testid="direct-uncertain" className="space-y-2 text-sm text-amber-700 dark:text-amber-400">
            <p>{t("customer.direct.uncertain")}</p>
            {direct.retryErrorMessage && (
              <p data-testid="direct-retry-rejected">
                {t("customer.direct.retryRejected")} {message(direct.retryErrorMessage)}
              </p>
            )}
            <ButtonSecondary type="button" onClick={retryDirectExact}>
              {t("customer.direct.retry")}
            </ButtonSecondary>
          </div>
        )}

        {phase !== "uncertain" && (
          <ButtonPrimary type="submit" loading={phase === "submitting"} disabled={locked || priceChange !== null || unresolvedMarker}>
            {phase === "submitting" ? t("customer.direct.confirming") : t("customer.direct.confirm")}
          </ButtonPrimary>
        )}
      </form>
    </div>
  );
};

export default DirectBookingPanel;
