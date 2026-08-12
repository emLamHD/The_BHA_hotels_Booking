"use client";

import React, { FC, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Heading from "@/shared/Heading";
import Input from "@/shared/Input";
import Select from "@/shared/Select";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";
import AvailabilityOfferCard from "@/components/AvailabilityOfferCard";
import BookingHoldPanel from "@/components/BookingHoldPanel";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { runIfAvailabilitySearchAllowed } from "@/lib/api/bookingHoldFlowController";
import { runAvailabilityFormSubmit } from "@/lib/api/availabilityFormSubmit";
import { searchAvailability } from "@/lib/api/availabilityService";
import { AvailabilityOfferDto, AvailabilityQuery } from "@/lib/api/availabilityTypes";
import { AvailabilityDraft, AvailabilityFieldErrors } from "@/lib/api/availabilityValidation";
import { PropertyDto } from "@/lib/api/propertyTypes";
import {
  ApiConfigError,
  ApiHttpError,
  ApiNetworkError,
  ApiValidationError,
} from "@/lib/api/errors";
import { isRequestCancelledError } from "@/lib/api/httpClient";

export interface SectionAvailabilitySearchProps {
  className?: string;
  properties: PropertyDto[];
}

type SearchStatus = "initial" | "loading" | "success" | "empty" | "error";

interface SubmittedQuery extends AvailabilityQuery {
  propertyId: string;
  propertyName: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local-date-only default for the form's initial value; a UX convenience, not a validation authority. */
function localDateIso(offsetDays: number): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function describeError(error: unknown): string {
  if (error instanceof ApiConfigError) {
    return "The availability service is not configured correctly.";
  }
  if (error instanceof ApiNetworkError) {
    return "We couldn't reach the availability service. Check your connection and try again.";
  }
  if (error instanceof ApiValidationError) {
    const firstFieldMessage = Object.values(error.errors).flat()[0];
    return firstFieldMessage ?? error.problem.detail ?? error.problem.title;
  }
  if (error instanceof ApiHttpError) {
    return error.problem.detail ?? error.problem.title;
  }
  return "Something went wrong while searching availability.";
}

const SectionAvailabilitySearch: FC<SectionAvailabilitySearchProps> = ({
  className = "",
  properties,
}) => {
  const [propertyId, setPropertyId] = useState<string>(properties[0]?.id ?? "");
  const [draft, setDraft] = useState<AvailabilityDraft>(() => ({
    checkIn: localDateIso(0),
    checkOut: localDateIso(1),
    adults: "1",
    children: "0",
    rooms: "1",
  }));
  const [fieldErrors, setFieldErrors] = useState<AvailabilityFieldErrors>({});
  const [status, setStatus] = useState<SearchStatus>("initial");
  const [offers, setOffers] = useState<AvailabilityOfferDto[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedQuery, setSubmittedQuery] = useState<SubmittedQuery | null>(null);

  const {
    state: holdFlowState,
    selectOffer,
    tryBeginAvailabilitySearch,
    isAvailabilitySearchLocked,
  } = useBookingHoldFlow();
  const holdPhase = holdFlowState.phase;
  // Search, retry-search, every Availability input, and offer switching are
  // all blocked while a Hold attempt is in flight, its outcome is
  // unresolved, it has already succeeded, or the confirmation lifecycle
  // (confirming/confirm-known-error/confirm-uncertain/reservation-result)
  // is underway or resolved (no second Hold, ever). Read directly from the
  // authoritative controller predicate — the same one `tryBeginAvailabilitySearch()`
  // uses internally — so this display/accessibility value can never drift
  // from the phase list the reducer/controller actually enforce. This value
  // only drives *display*; the actual behavioral authority remains the
  // synchronous `tryBeginAvailabilitySearch()` gate below, which a stale
  // render of this boolean can never bypass.
  const flowLocked = isAvailabilitySearchLocked();

  const activeRequest = useRef<AbortController | null>(null);
  const latestRequestId = useRef(0);

  const runSearch = useCallback(
    (targetPropertyId: string, query: AvailabilityQuery, propertyName: string) => {
      // `runIfAvailabilitySearchAllowed` consults the single authoritative,
      // synchronous coordinator gate and performs *none* of the side
      // effects below (no abort, no request-identity bump, no local state
      // change, no network call) unless it accepts the operation. On
      // acceptance, it has already synchronously invalidated any current
      // Hold offer selection, so a same-tick Hold submit afterward can
      // never use the now-obsolete offer.
      runIfAvailabilitySearchAllowed(tryBeginAvailabilitySearch, () => {
        // Abort any in-flight attempt before starting a new one, and bump
        // the request identity so an older response that resolves later
        // (even post-abort) can never overwrite a newer attempt's state.
        activeRequest.current?.abort();
        const controller = new AbortController();
        activeRequest.current = controller;
        const requestId = ++latestRequestId.current;

        setStatus("loading");
        setErrorMessage(null);
        setSubmittedQuery({ propertyId: targetPropertyId, propertyName, ...query });

        searchAvailability(targetPropertyId, query, { signal: controller.signal })
          .then((data) => {
            if (requestId !== latestRequestId.current || controller.signal.aborted) {
              return;
            }
            setOffers(data);
            setStatus(data.length === 0 ? "empty" : "success");
          })
          .catch((error) => {
            if (isRequestCancelledError(error) || controller.signal.aborted) {
              return;
            }
            if (requestId !== latestRequestId.current) {
              return;
            }
            setOffers([]);
            setErrorMessage(describeError(error));
            setStatus("error");
          });
      });
    },
    [tryBeginAvailabilitySearch]
  );

  useEffect(() => {
    return () => {
      activeRequest.current?.abort();
    };
  }, []);

  // If the live Property list changes such that the selected Property is no
  // longer present, abort any in-flight request using it and deterministically
  // fall back to the first still-valid Property rather than silently keeping
  // stale results attributed to a Property that no longer exists.
  useEffect(() => {
    if (properties.length === 0) {
      return;
    }
    const stillValid = properties.some((property) => property.id === propertyId);
    if (!stillValid) {
      activeRequest.current?.abort();
      latestRequestId.current += 1;
      setPropertyId(properties[0].id);
      setStatus("initial");
      setOffers([]);
      setErrorMessage(null);
      setSubmittedQuery(null);
    }
  }, [properties, propertyId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The authoritative same-tick Hold-flow lock is consulted first, inside
    // `runAvailabilityFormSubmit`, *before* draft validation or any
    // field-error state change — never the React-rendered `flowLocked`
    // boolean, which can still read `false` in the exact tick a Hold
    // submit/retry already acquired the coordinator's synchronous lock. A
    // locked same-tick submit is therefore a complete no-op regardless of
    // whether the current draft is valid or invalid.
    runAvailabilityFormSubmit(draft, {
      isAvailabilitySearchLocked,
      setFieldErrors,
      runSearch: (query) => {
        const property = properties.find((item) => item.id === propertyId);
        runSearch(propertyId, query, property?.name ?? "Property");
      },
    });
  };

  const handleRetryLastSearch = () => {
    if (isAvailabilitySearchLocked() || !submittedQuery) {
      return;
    }
    const { propertyId: pid, propertyName, ...query } = submittedQuery;
    runSearch(pid, query, propertyName);
  };

  const handleSelectOffer = (offer: AvailabilityOfferDto) => {
    if (flowLocked || !submittedQuery) {
      return;
    }
    selectOffer(
      {
        propertyId: submittedQuery.propertyId,
        roomTypeId: offer.roomTypeId,
        ratePlanId: offer.ratePlanId,
        checkIn: submittedQuery.checkIn,
        checkOut: submittedQuery.checkOut,
        adults: submittedQuery.adults,
        children: submittedQuery.children,
        rooms: submittedQuery.rooms,
      },
      `${offer.roomTypeName ?? "Room type"} · ${offer.ratePlanName ?? "Rate plan"} at ${submittedQuery.propertyName}`
    );
  };

  if (properties.length === 0) {
    return null;
  }

  return (
    <div className={`nc-SectionAvailabilitySearch relative ${className}`}>
      <Heading desc="Search real stay offers with live nightly rates and inventory">
        Check availability
      </Heading>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <div>
            <label
              htmlFor="availability-property"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Property
            </label>
            <Select
              id="availability-property"
              value={propertyId}
              disabled={flowLocked}
              onChange={(event) => setPropertyId(event.target.value)}
            >
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name ?? "Property"}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label
              htmlFor="availability-checkin"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Check-in
            </label>
            <Input
              id="availability-checkin"
              type="date"
              value={draft.checkIn}
              disabled={flowLocked}
              onChange={(event) =>
                setDraft((current) => ({ ...current, checkIn: event.target.value }))
              }
              aria-invalid={!!fieldErrors.checkIn}
              aria-describedby={fieldErrors.checkIn ? "availability-checkin-error" : undefined}
            />
            {fieldErrors.checkIn && (
              <p
                id="availability-checkin-error"
                role="alert"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {fieldErrors.checkIn}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="availability-checkout"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Check-out
            </label>
            <Input
              id="availability-checkout"
              type="date"
              value={draft.checkOut}
              disabled={flowLocked}
              onChange={(event) =>
                setDraft((current) => ({ ...current, checkOut: event.target.value }))
              }
              aria-invalid={!!fieldErrors.checkOut}
              aria-describedby={fieldErrors.checkOut ? "availability-checkout-error" : undefined}
            />
            {fieldErrors.checkOut && (
              <p
                id="availability-checkout-error"
                role="alert"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {fieldErrors.checkOut}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="availability-adults"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Adults
            </label>
            <Input
              id="availability-adults"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={draft.adults}
              disabled={flowLocked}
              onChange={(event) =>
                setDraft((current) => ({ ...current, adults: event.target.value }))
              }
              aria-invalid={!!fieldErrors.adults}
              aria-describedby={fieldErrors.adults ? "availability-adults-error" : undefined}
            />
            {fieldErrors.adults && (
              <p
                id="availability-adults-error"
                role="alert"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {fieldErrors.adults}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="availability-children"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Children
            </label>
            <Input
              id="availability-children"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={draft.children}
              disabled={flowLocked}
              onChange={(event) =>
                setDraft((current) => ({ ...current, children: event.target.value }))
              }
              aria-invalid={!!fieldErrors.children}
              aria-describedby={fieldErrors.children ? "availability-children-error" : undefined}
            />
            {fieldErrors.children && (
              <p
                id="availability-children-error"
                role="alert"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {fieldErrors.children}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="availability-rooms"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Rooms
            </label>
            <Input
              id="availability-rooms"
              type="number"
              min={1}
              max={10}
              step={1}
              inputMode="numeric"
              value={draft.rooms}
              disabled={flowLocked}
              onChange={(event) =>
                setDraft((current) => ({ ...current, rooms: event.target.value }))
              }
              aria-invalid={!!fieldErrors.rooms}
              aria-describedby={fieldErrors.rooms ? "availability-rooms-error" : undefined}
            />
            {fieldErrors.rooms && (
              <p
                id="availability-rooms-error"
                role="alert"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {fieldErrors.rooms}
              </p>
            )}
          </div>
        </div>

        <div>
          <ButtonPrimary type="submit" disabled={flowLocked}>
            Search availability
          </ButtonPrimary>
        </div>
      </form>

      <div className="mt-8">
        {status === "initial" && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Enter your dates and guests, then search to see real stay offers.
          </p>
        )}

        {status === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="py-10 text-center text-neutral-500 dark:text-neutral-400"
          >
            Searching availability…
          </div>
        )}

        {status === "error" && (
          <div
            role="alert"
            className="py-10 flex flex-col items-center text-center space-y-4"
          >
            <p className="text-neutral-600 dark:text-neutral-300">{errorMessage}</p>
            <ButtonSecondary onClick={handleRetryLastSearch} disabled={flowLocked}>
              Retry last search
            </ButtonSecondary>
          </div>
        )}

        {status === "empty" && submittedQuery && (
          <div
            role="status"
            className="py-10 text-center text-neutral-500 dark:text-neutral-400"
          >
            No offers matched {submittedQuery.checkIn} → {submittedQuery.checkOut} for{" "}
            {submittedQuery.adults} adult(s), {submittedQuery.children} child(ren),{" "}
            {submittedQuery.rooms} room(s) at {submittedQuery.propertyName}.
          </div>
        )}

        {status === "success" && submittedQuery && (
          <>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
              Showing offers for {submittedQuery.propertyName}: {submittedQuery.checkIn} →{" "}
              {submittedQuery.checkOut} · {submittedQuery.adults} adult(s),{" "}
              {submittedQuery.children} child(ren) · {submittedQuery.rooms} room(s)
            </p>
            <div className="grid gap-6 md:gap-8 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {offers.map((offer) => (
                <AvailabilityOfferCard
                  key={`${offer.roomTypeId}:${offer.ratePlanId}`}
                  data={offer}
                  onHold={() => handleSelectOffer(offer)}
                  holdDisabled={flowLocked}
                />
              ))}
            </div>
          </>
        )}

        {holdPhase !== "idle" && <BookingHoldPanel className="mt-8" />}
      </div>
    </div>
  );
};

export default SectionAvailabilitySearch;
