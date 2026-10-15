"use client";

import React, { FC, FormEvent, useEffect, useRef } from "react";
import Input from "@/shared/Input";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import PriceBreakdown from "@/components/PriceBreakdown";
import { useApiMessage } from "@/lib/i18n/apiMessage";
import { ActiveHoldSession } from "@/lib/api/bookingHoldAttempt";
import { ReservationDto } from "@/lib/api/bookingHoldTypes";
import { useDateFormat } from "@/lib/i18n/dates";
import { partyLine } from "@/lib/i18n/party";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Translate } from "@/lib/i18n/types";

export interface BookingHoldPanelProps {
  className?: string;
}

/** The pack text of a status the API sent as a word (`Active`); a status this site has no text for is shown as sent. */
function statusText(t: Translate, has: (key: string) => boolean, key: string, raw: string): string {
  return has(`${key}.${raw}`) ? t(`${key}.${raw}`) : raw;
}

/** Shared customer-safe Hold summary for every session-carrying lifecycle phase. */
function HoldSummary({ session }: { session: ActiveHoldSession }) {
  const { hold } = session;
  const { t, has } = useI18n();
  const dates = useDateFormat();
  return (
    <div role="status" aria-live="polite" className="space-y-3 text-sm">
      <p className="text-neutral-600 dark:text-neutral-300">
        {t("customer.booking.hold.status")}{" "}
        <span className="font-medium">{statusText(t, has, "customer.booking.hold.status", hold.status)}</span> ·{" "}
        {t("customer.booking.hold.holdId")} <span className="font-mono text-xs">{hold.holdId}</span>
      </p>
      <p className="text-neutral-600 dark:text-neutral-300">{partyLine(t, dates, hold)}</p>
      <PriceBreakdown
        rows={(hold.nights ?? []).map((night) => ({ key: night.stayDate, label: dates.stayDate(night.stayDate), amount: night.nightTotal }))}
        totalAmount={hold.totalAmount}
        currencyCode={hold.currencyCode}
        totalLabel={t("customer.booking.hold.total")}
      />
      <p className="text-neutral-500 dark:text-neutral-400">
        {t("customer.booking.hold.created", { time: dates.instant(hold.createdAtUtc) })} ·{" "}
        {t("customer.booking.hold.expires", { time: dates.instant(hold.expiresAtUtc) })}
      </p>
      {session.guestAccessToken ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t("customer.booking.hold.keepTab")}</p>
      ) : (
        <p className="text-neutral-500 dark:text-neutral-400">{t("customer.booking.hold.existingHold")}</p>
      )}
    </div>
  );
}

/** Renders each server-returned night snapshot directly; an honest fallback if none are available. */
function ReservationNights({ reservation }: { reservation: ReservationDto }) {
  const { t } = useI18n();
  const dates = useDateFormat();
  const nights = reservation.nights;
  if (!nights || nights.length === 0) {
    return (
      <>
        <p className="text-neutral-500 dark:text-neutral-400">{t("customer.booking.hold.noNightly")}</p>
        <PriceBreakdown rows={[]} totalAmount={reservation.totalAmount} currencyCode={reservation.currencyCode} totalLabel={t("customer.booking.hold.total")} />
      </>
    );
  }
  return (
    <PriceBreakdown
      rows={nights.map((night) => ({
        key: night.stayDate,
        label: `${dates.stayDate(night.stayDate)} · ${t("customer.booking.rooms", { rooms: night.rooms })}`,
        amount: night.nightTotal,
        unitAmount: night.unitAmount,
      }))}
      totalAmount={reservation.totalAmount}
      currencyCode={reservation.currencyCode}
      totalLabel={t("customer.booking.hold.total")}
      rowClassName="flex justify-between gap-4 py-1 text-sm"
    />
  );
}

/**
 * Renders purely from the app-lifetime authoritative flow
 * (`useBookingHoldFlow`) — it owns no submission state, immutable attempt,
 * or AbortController of its own, so this panel (or /home-2 itself)
 * unmounting during client navigation never aborts an in-flight request or
 * loses the retained session/guest token. The confirmation lifecycle
 * (confirming/confirm-known-error/confirm-uncertain/reservation-result)
 * follows the same rule: `confirmHold`/`retryConfirmationExact` are called
 * with no arguments, and the panel reads only the reducer's own state.
 */
const BookingHoldPanel: FC<BookingHoldPanelProps> = ({ className = "" }) => {
  const { state, updateContact, submit, retryExact, confirmHold, retryConfirmationExact } =
    useBookingHoldFlow();
  const { t, has } = useI18n();
  const dates = useDateFormat();
  const message = useApiMessage();
  const { phase, offer, offerLabel, contact, fieldErrors, errorMessage, session, reservationResult } =
    state;

  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    // Re-focus whenever the panel's headline content changes (new
    // selection or a resolved outcome), not on every contact keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, offer?.roomTypeId, offer?.ratePlanId]);

  // An invalid submit moves focus to the first field with an error (the errors are also read out via
  // aria-describedby), so the keyboard and screen-reader user lands where the problem is.
  useEffect(() => {
    if (!fieldErrors) return;
    const firstInvalid = (["fullName", "email", "phone"] as const).find((field) => fieldErrors[field]);
    if (firstInvalid) {
      document.getElementById(`hold-${firstInvalid === "fullName" ? "full-name" : firstInvalid}`)?.focus();
    }
  }, [fieldErrors]);

  const locked = phase === "submitting" || phase === "uncertain";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  if (phase === "reservation-result" && reservationResult) {
    const { reservation, outcome } = reservationResult;
    return (
      <div
        className={`nc-BookingHoldPanel rounded-3xl border border-neutral-200/80 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 space-y-4 ${className}`}
      >
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          {t("customer.booking.hold.reservationConfirmed")}
        </h3>
        <div role="status" aria-live="polite" className="space-y-3 text-sm">
          {outcome === "replayed" && (
            <p className="text-neutral-600 dark:text-neutral-300">
              {t("customer.booking.hold.alreadyConfirmed")}
            </p>
          )}
          <p className="text-neutral-600 dark:text-neutral-300">
            {t("customer.booking.hold.confirmationNumber")}{" "}
            <span className="font-mono text-xs">{reservation.confirmationNumber}</span> · {t("customer.booking.hold.status")}{" "}
            <span className="font-medium">{statusText(t, has, "customer.booking.reservation.status", reservation.status)}</span>
          </p>
          <p className="text-neutral-600 dark:text-neutral-300">
            {partyLine(t, dates, reservation)}
          </p>
          <ReservationNights reservation={reservation} />
          <p className="text-neutral-500 dark:text-neutral-400">
            {t("customer.booking.hold.confirmed", { time: dates.instant(reservation.confirmedAtUtc) })}
          </p>
        </div>
      </div>
    );
  }

  if (
    (phase === "active-session" ||
      phase === "confirming" ||
      phase === "confirm-known-error" ||
      phase === "confirm-uncertain") &&
    session
  ) {
    return (
      <div
        className={`nc-BookingHoldPanel rounded-3xl border border-neutral-200/80 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 space-y-4 ${className}`}
      >
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          {session.outcome === "created" ? t("customer.booking.hold.holdCreated") : t("customer.booking.hold.holdExists")}
        </h3>
        <HoldSummary session={session} />

        {phase === "active-session" && (
          <ButtonPrimary type="button" onClick={confirmHold}>
            {t("customer.booking.hold.confirmReservation")}
          </ButtonPrimary>
        )}

        {phase === "confirming" && (
          <>
            <div
              role="status"
              aria-live="polite"
              className="text-sm text-neutral-500 dark:text-neutral-400"
            >
              {t("customer.booking.hold.confirming")}
            </div>
            <ButtonPrimary type="button" loading>
              {t("customer.booking.hold.confirmReservation")}
            </ButtonPrimary>
          </>
        )}

        {phase === "confirm-known-error" && errorMessage && (
          <>
            <div role="alert" className="text-sm text-red-600 dark:text-red-400">
              {message(errorMessage)}
            </div>
            <ButtonSecondary type="button" onClick={retryConfirmationExact}>
              {t("customer.booking.hold.retryConfirmation")}
            </ButtonSecondary>
          </>
        )}

        {phase === "confirm-uncertain" && (
          <div role="alert" className="space-y-2 text-sm text-amber-600 dark:text-amber-400">
            <p>{t("customer.booking.hold.confirmUncertain")}</p>
            <ButtonSecondary type="button" onClick={retryConfirmationExact}>
              {t("customer.booking.hold.retryExactConfirmation")}
            </ButtonSecondary>
          </div>
        )}
      </div>
    );
  }

  if (phase === "idle" || !offer) {
    return null;
  }

  return (
    <div
      className={`nc-BookingHoldPanel rounded-3xl border border-neutral-200/80 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 space-y-4 ${className}`}
    >
      <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
        {t("customer.booking.hold.holdThisRoom")}
      </h3>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{offerLabel}</p>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label
            htmlFor="hold-full-name"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            {t("customer.booking.hold.fullName")}
          </label>
          <Input
            id="hold-full-name"
            type="text"
            autoComplete="name"
            value={contact.fullName}
            disabled={locked}
            onChange={(event) => updateContact({ ...contact, fullName: event.target.value })}
            aria-invalid={!!fieldErrors?.fullName}
            aria-describedby={fieldErrors?.fullName ? "hold-full-name-error" : undefined}
          />
          {fieldErrors?.fullName && (
            <p id="hold-full-name-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {message(fieldErrors.fullName)}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="hold-email"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            {t("customer.booking.hold.email")}
          </label>
          <Input
            id="hold-email"
            type="email"
            autoComplete="email"
            value={contact.email}
            disabled={locked}
            onChange={(event) => updateContact({ ...contact, email: event.target.value })}
            aria-invalid={!!fieldErrors?.email}
            aria-describedby={fieldErrors?.email ? "hold-email-error" : undefined}
          />
          {fieldErrors?.email && (
            <p id="hold-email-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {message(fieldErrors.email)}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="hold-phone"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            {t("customer.booking.hold.phone")}
          </label>
          <Input
            id="hold-phone"
            type="tel"
            autoComplete="tel"
            value={contact.phone}
            disabled={locked}
            onChange={(event) => updateContact({ ...contact, phone: event.target.value })}
            aria-invalid={!!fieldErrors?.phone}
            aria-describedby={fieldErrors?.phone ? "hold-phone-error" : undefined}
          />
          {fieldErrors?.phone && (
            <p id="hold-phone-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {message(fieldErrors.phone)}
            </p>
          )}
        </div>

        {phase === "submitting" && (
          <div role="status" aria-live="polite" className="text-sm text-neutral-500 dark:text-neutral-400">
            {t("customer.booking.hold.creating")}
          </div>
        )}

        {phase === "known-error" && errorMessage && (
          <div role="alert" className="text-sm text-red-600 dark:text-red-400">
            {message(errorMessage)}
          </div>
        )}

        {phase === "uncertain" && (
          <div role="alert" className="space-y-2 text-sm text-amber-600 dark:text-amber-400">
            <p>{t("customer.booking.hold.holdUncertain")}</p>
            <ButtonSecondary type="button" onClick={retryExact}>
              {t("customer.booking.hold.retryExactRequest")}
            </ButtonSecondary>
          </div>
        )}

        {phase !== "uncertain" && (
          <ButtonPrimary type="submit" loading={phase === "submitting"} disabled={locked}>
            {phase === "submitting" ? t("customer.booking.hold.creating") : t("customer.booking.hold.create")}
          </ButtonPrimary>
        )}
      </form>
    </div>
  );
};

export default BookingHoldPanel;
