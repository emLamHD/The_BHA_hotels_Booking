"use client";

import React, { FC, FormEvent, useEffect, useRef } from "react";
import Input from "@/shared/Input";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { formatCurrencyAmount } from "@/lib/api/availabilityPresentation";
import { ActiveHoldSession } from "@/lib/api/bookingHoldAttempt";
import { ReservationDto } from "@/lib/api/bookingHoldTypes";

export interface BookingHoldPanelProps {
  className?: string;
}

function formatUtcInstant(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

/** Shared customer-safe Hold summary for every session-carrying lifecycle phase. */
function renderHoldSummary(session: ActiveHoldSession) {
  const { hold } = session;
  return (
    <div role="status" aria-live="polite" className="space-y-3 text-sm">
      <p className="text-neutral-600 dark:text-neutral-300">
        Status <span className="font-medium">{hold.status}</span> · Hold ID{" "}
        <span className="font-mono text-xs">{hold.holdId}</span>
      </p>
      <p className="text-neutral-600 dark:text-neutral-300">
        {hold.checkIn} → {hold.checkOut} · {hold.rooms} room{hold.rooms === 1 ? "" : "s"} ·{" "}
        {hold.adults} adult{hold.adults === 1 ? "" : "s"}
        {hold.children > 0 ? `, ${hold.children} child(ren)` : ""}
      </p>
      {hold.nights && hold.nights.length > 0 && (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {hold.nights.map((night) => (
            <li key={night.stayDate} className="flex justify-between gap-4 py-1">
              <span>{night.stayDate}</span>
              <span>{formatCurrencyAmount(night.nightTotal, hold.currencyCode)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between items-center border-t border-neutral-200/80 dark:border-neutral-700 pt-3">
        <span className="text-neutral-500 dark:text-neutral-400">Total</span>
        <span className="text-base font-semibold text-secondary-500">
          {formatCurrencyAmount(hold.totalAmount, hold.currencyCode)}
        </span>
      </div>
      <p className="text-neutral-500 dark:text-neutral-400">
        Created {formatUtcInstant(hold.createdAtUtc)} · Expires{" "}
        {formatUtcInstant(hold.expiresAtUtc)}
      </p>
      {session.guestAccessToken ? (
        <p className="text-neutral-500 dark:text-neutral-400">
          Please remain in this browser tab — your one-time guest access code is stored only
          in memory for this application session and cannot be shown again or recovered
          later.
        </p>
      ) : (
        <p className="text-neutral-500 dark:text-neutral-400">
          This Hold was already created earlier. No new one-time guest access code was
          issued, and — if this browser tab does not already have one retained — later
          anonymous access cannot be recovered from this response.
        </p>
      )}
    </div>
  );
}

/** Renders each server-returned night snapshot directly; an honest fallback if none are available. */
function renderReservationNights(
  nights: ReservationDto["nights"],
  currencyCode: ReservationDto["currencyCode"]
) {
  if (!nights || nights.length === 0) {
    return (
      <p className="text-neutral-500 dark:text-neutral-400">
        Nightly pricing details are not available for this reservation.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {nights.map((night) => (
        <li key={night.stayDate} className="flex justify-between gap-4 py-1 text-sm">
          <span>
            {night.stayDate} · {night.rooms} room{night.rooms === 1 ? "" : "s"} ·{" "}
            {formatCurrencyAmount(night.unitAmount, currencyCode)}
          </span>
          <span>{formatCurrencyAmount(night.nightTotal, currencyCode)}</span>
        </li>
      ))}
    </ul>
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
  const { phase, offer, offerLabel, contact, fieldErrors, errorMessage, session, reservationResult } =
    state;

  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    // Re-focus whenever the panel's headline content changes (new
    // selection or a resolved outcome), not on every contact keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, offer?.roomTypeId, offer?.ratePlanId]);

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
          Reservation confirmed
        </h3>
        <div role="status" aria-live="polite" className="space-y-3 text-sm">
          {outcome === "replayed" && (
            <p className="text-neutral-600 dark:text-neutral-300">
              This reservation was already confirmed. Here is the existing confirmation.
            </p>
          )}
          <p className="text-neutral-600 dark:text-neutral-300">
            Confirmation number{" "}
            <span className="font-mono text-xs">{reservation.confirmationNumber}</span> · Status{" "}
            <span className="font-medium">{reservation.status}</span>
          </p>
          <p className="text-neutral-600 dark:text-neutral-300">
            {reservation.checkIn} → {reservation.checkOut} · {reservation.rooms} room
            {reservation.rooms === 1 ? "" : "s"} · {reservation.adults} adult
            {reservation.adults === 1 ? "" : "s"}
            {reservation.children > 0 ? `, ${reservation.children} child(ren)` : ""}
          </p>
          {renderReservationNights(reservation.nights, reservation.currencyCode)}
          <div className="flex justify-between items-center border-t border-neutral-200/80 dark:border-neutral-700 pt-3">
            <span className="text-neutral-500 dark:text-neutral-400">Total</span>
            <span className="text-base font-semibold text-secondary-500">
              {formatCurrencyAmount(reservation.totalAmount, reservation.currencyCode)}
            </span>
          </div>
          <p className="text-neutral-500 dark:text-neutral-400">
            Confirmed {formatUtcInstant(reservation.confirmedAtUtc)}
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
          {session.outcome === "created" ? "Hold created" : "Hold already exists"}
        </h3>
        {renderHoldSummary(session)}

        {phase === "active-session" && (
          <ButtonPrimary type="button" onClick={confirmHold}>
            Confirm reservation
          </ButtonPrimary>
        )}

        {phase === "confirming" && (
          <>
            <div
              role="status"
              aria-live="polite"
              className="text-sm text-neutral-500 dark:text-neutral-400"
            >
              Confirming your reservation…
            </div>
            <ButtonPrimary type="button" loading>
              Confirm reservation
            </ButtonPrimary>
          </>
        )}

        {phase === "confirm-known-error" && errorMessage && (
          <>
            <div role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errorMessage}
            </div>
            <ButtonSecondary type="button" onClick={retryConfirmationExact}>
              Retry confirmation
            </ButtonSecondary>
          </>
        )}

        {phase === "confirm-uncertain" && (
          <div role="alert" className="space-y-2 text-sm text-amber-600 dark:text-amber-400">
            <p>
              We couldn&apos;t confirm whether your reservation was completed — the connection
              was lost before a response arrived. Retrying resends the exact same confirmation
              for this Hold; it will not create a second reservation.
            </p>
            <ButtonSecondary type="button" onClick={retryConfirmationExact}>
              Retry exact confirmation
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
        Hold this room
      </h3>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{offerLabel}</p>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label
            htmlFor="hold-full-name"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            Full name
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
              {fieldErrors.fullName}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="hold-email"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            Email
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
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="hold-phone"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            Phone
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
              {fieldErrors.phone}
            </p>
          )}
        </div>

        {phase === "submitting" && (
          <div role="status" aria-live="polite" className="text-sm text-neutral-500 dark:text-neutral-400">
            Creating your 15-minute Hold…
          </div>
        )}

        {phase === "known-error" && errorMessage && (
          <div role="alert" className="text-sm text-red-600 dark:text-red-400">
            {errorMessage}
          </div>
        )}

        {phase === "uncertain" && (
          <div role="alert" className="space-y-2 text-sm text-amber-600 dark:text-amber-400">
            <p>
              We couldn&apos;t confirm whether your Hold was created — the connection was lost
              before a response arrived. Sending again reuses the exact same request.
            </p>
            <ButtonSecondary type="button" onClick={retryExact}>
              Retry exact request
            </ButtonSecondary>
          </div>
        )}

        {phase !== "uncertain" && (
          <ButtonPrimary type="submit" loading={phase === "submitting"} disabled={locked}>
            {phase === "submitting" ? "Creating your 15-minute Hold…" : "Create 15-minute Hold"}
          </ButtonPrimary>
        )}
      </form>
    </div>
  );
};

export default BookingHoldPanel;
