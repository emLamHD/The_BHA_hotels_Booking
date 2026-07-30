"use client";

import React, { FC, FormEvent, useEffect, useRef, useState } from "react";
import Input from "@/shared/Input";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { createBookingHold } from "@/lib/api/bookingHoldService";
import {
  ActiveHoldSession,
  BookingHoldAttemptSnapshot,
  ContactFieldErrors,
  ContactInput,
  SelectedOfferSnapshot,
  buildBookingHoldRequest,
  mergeHoldSession,
  validateContact,
} from "@/lib/api/bookingHoldAttempt";
import { generateIdempotencyKey } from "@/lib/api/idempotencyKey";
import { formatCurrencyAmount } from "@/lib/api/availabilityPresentation";
import {
  ApiConfigError,
  ApiHttpError,
  ApiNetworkError,
  ApiValidationError,
} from "@/lib/api/errors";
import { isRequestCancelledError } from "@/lib/api/httpClient";

type SubmissionStatus = "idle" | "submitting" | "known-error" | "uncertain";

export interface BookingHoldPanelProps {
  className?: string;
  offer: SelectedOfferSnapshot;
  offerLabel: string;
  session: ActiveHoldSession | null;
  onSessionChange: (session: ActiveHoldSession) => void;
}

function offerKeyOf(offer: SelectedOfferSnapshot): string {
  return [
    offer.propertyId,
    offer.roomTypeId,
    offer.ratePlanId,
    offer.checkIn,
    offer.checkOut,
    offer.adults,
    offer.children,
    offer.rooms,
  ].join(":");
}

function formatUtcInstant(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

function describeError(error: unknown): string {
  if (error instanceof ApiValidationError) {
    const firstFieldMessage = Object.values(error.errors).flat()[0];
    return firstFieldMessage ?? error.problem.detail ?? error.problem.title;
  }
  if (error instanceof ApiHttpError) {
    return error.problem.detail ?? error.problem.title;
  }
  if (error instanceof ApiConfigError) {
    return "The booking service is not configured correctly.";
  }
  return "Something went wrong while creating your Hold.";
}

const BookingHoldPanel: FC<BookingHoldPanelProps> = ({
  className = "",
  offer,
  offerLabel,
  session,
  onSessionChange,
}) => {
  const [contact, setContact] = useState<ContactInput>({ fullName: "", email: "", phone: "" });
  const [fieldErrors, setFieldErrors] = useState<ContactFieldErrors | null>(null);
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const attemptRef = useRef<BookingHoldAttemptSnapshot | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const previousOfferKeyRef = useRef(offerKeyOf(offer));
  const headingRef = useRef<HTMLHeadingElement>(null);

  // A different offer was selected before this attempt succeeded: abandon
  // the previous immutable attempt rather than silently reusing its key.
  useEffect(() => {
    const key = offerKeyOf(offer);
    if (previousOfferKeyRef.current !== key && !session) {
      previousOfferKeyRef.current = key;
      attemptRef.current = null;
      setStatus("idle");
      setErrorMessage(null);
      setFieldErrors(null);
    } else {
      previousOfferKeyRef.current = key;
    }
  }, [offer, session]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const runAttempt = async (attempt: BookingHoldAttemptSnapshot) => {
    setStatus("submitting");
    setErrorMessage(null);
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const result = await createBookingHold(attempt.request, attempt.idempotencyKey, {
        signal: controller.signal,
      });
      onSessionChange(mergeHoldSession(session, result));
      setStatus("idle");
    } catch (error) {
      if (isRequestCancelledError(error)) {
        return;
      }
      if (error instanceof ApiNetworkError) {
        setStatus("uncertain");
        return;
      }
      if (
        error instanceof ApiValidationError ||
        error instanceof ApiHttpError ||
        error instanceof ApiConfigError
      ) {
        setStatus("known-error");
        setErrorMessage(describeError(error));
        return;
      }
      // Unclassified failure: honestly ambiguous rather than falsely "known".
      setStatus("uncertain");
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "submitting" || session) {
      return;
    }

    const errors = validateContact(contact);
    if (errors) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors(null);

    const attempt: BookingHoldAttemptSnapshot = {
      request: buildBookingHoldRequest(offer, contact),
      idempotencyKey: generateIdempotencyKey(),
    };
    attemptRef.current = attempt;
    void runAttempt(attempt);
  };

  const handleExactRetry = () => {
    if (status === "submitting" || !attemptRef.current) {
      return;
    }
    void runAttempt(attemptRef.current);
  };

  if (session) {
    const { hold } = session;
    return (
      <div
        className={`nc-BookingHoldPanel rounded-3xl border border-neutral-200/80 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 space-y-4 ${className}`}
      >
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          {session.outcome === "created" ? "Hold created" : "Hold already exists"}
        </h3>
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
              Please remain in this tab — your one-time guest access code is stored only for
              this browser session and cannot be shown again or recovered later.
            </p>
          ) : (
            <p className="text-neutral-500 dark:text-neutral-400">
              This Hold was already created earlier. No new one-time guest access code was
              issued, and — if this browser tab does not already have one retained — later
              anonymous access cannot be recovered from this response.
            </p>
          )}
        </div>
      </div>
    );
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
            disabled={status === "submitting"}
            onChange={(event) =>
              setContact((current) => ({ ...current, fullName: event.target.value }))
            }
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
            disabled={status === "submitting"}
            onChange={(event) =>
              setContact((current) => ({ ...current, email: event.target.value }))
            }
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
            disabled={status === "submitting"}
            onChange={(event) =>
              setContact((current) => ({ ...current, phone: event.target.value }))
            }
            aria-invalid={!!fieldErrors?.phone}
            aria-describedby={fieldErrors?.phone ? "hold-phone-error" : undefined}
          />
          {fieldErrors?.phone && (
            <p id="hold-phone-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {fieldErrors.phone}
            </p>
          )}
        </div>

        {status === "submitting" && (
          <div role="status" aria-live="polite" className="text-sm text-neutral-500 dark:text-neutral-400">
            Creating your Hold…
          </div>
        )}

        {status === "known-error" && errorMessage && (
          <div role="alert" className="text-sm text-red-600 dark:text-red-400">
            {errorMessage}
          </div>
        )}

        {status === "uncertain" && (
          <div role="alert" className="space-y-2 text-sm text-amber-600 dark:text-amber-400">
            <p>
              We couldn&apos;t confirm whether your Hold was created — the connection was lost
              before a response arrived. Sending again reuses the exact same request.
            </p>
            <ButtonSecondary type="button" onClick={handleExactRetry}>
              Retry exact request
            </ButtonSecondary>
          </div>
        )}

        <ButtonPrimary type="submit" loading={status === "submitting"} disabled={status === "submitting"}>
          {status === "submitting" ? "Creating your Hold…" : "Confirm Hold"}
        </ButtonPrimary>
      </form>
    </div>
  );
};

export default BookingHoldPanel;
