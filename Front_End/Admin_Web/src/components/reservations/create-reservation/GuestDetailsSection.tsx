"use client";

import React from "react";
import {
  MOCK_BOOKING_SOURCES,
  MOCK_PROPERTIES,
} from "@/components/calendar/reservation-board/mockData";
import type {
  BookingSourceId,
  Property,
  PropertyId,
} from "@/components/calendar/reservation-board/types";
import { MOCK_NATIONALITIES } from "./mockData";
import { findFieldError } from "./types";
import type { CreateReservationFormState, FieldError } from "./types";

interface GuestDetailsSectionProps {
  state: CreateReservationFormState;
  errors: FieldError[];
  showErrors: boolean;
  onPropertyChange: (propertyId: PropertyId) => void;
  onSourceChange: (sourceId: BookingSourceId) => void;
  onGuestFieldChange: (
    field: keyof CreateReservationFormState["guest"],
    value: string
  ) => void;
}

function fieldErrorProps(
  errors: FieldError[],
  showErrors: boolean,
  path: string,
  descriptionId: string
): { message: string | undefined; ariaDescribedBy: string | undefined } {
  const message = showErrors ? findFieldError(errors, path) : undefined;
  return { message, ariaDescribedBy: message ? descriptionId : undefined };
}

const inputClassName =
  "h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800";

const invalidInputClassName =
  "border-error-300 focus:border-error-300 focus:ring-error-500/10 dark:border-error-500/60";

const labelClassName = "mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300";

const errorTextClassName = "mt-1.5 text-xs text-error-600 dark:text-error-400";

const GuestDetailsSection: React.FC<GuestDetailsSectionProps> = ({
  state,
  errors,
  showErrors,
  onPropertyChange,
  onSourceChange,
  onGuestFieldChange,
}) => {
  const property = fieldErrorProps(errors, showErrors, "propertyId", "property-error");
  const source = fieldErrorProps(errors, showErrors, "sourceId", "source-error");
  const fullName = fieldErrorProps(errors, showErrors, "guest.fullName", "guest-full-name-error");
  const phone = fieldErrorProps(errors, showErrors, "guest.phone", "guest-phone-error");
  const email = fieldErrorProps(errors, showErrors, "guest.email", "guest-email-error");

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <fieldset>
        <legend className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
          Booking details
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="reservation-property" className={labelClassName}>
              Property <span className="text-error-500">*</span>
            </label>
            <select
              id="reservation-property"
              value={state.propertyId}
              onChange={(event) => onPropertyChange(event.target.value as PropertyId)}
              aria-invalid={Boolean(property.message)}
              aria-describedby={property.ariaDescribedBy}
              className={`${inputClassName} ${!state.propertyId ? "text-gray-400 dark:text-gray-500" : ""} ${property.message ? invalidInputClassName : ""}`}
            >
              <option value="" disabled hidden>
                Select a property…
              </option>
              {MOCK_PROPERTIES.map((option: Property) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            {property.message ? (
              <p id="property-error" className={errorTextClassName}>
                {property.message}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="reservation-source" className={labelClassName}>
              Booking source <span className="text-error-500">*</span>
            </label>
            <select
              id="reservation-source"
              value={state.sourceId}
              onChange={(event) => onSourceChange(event.target.value as BookingSourceId)}
              aria-invalid={Boolean(source.message)}
              aria-describedby={source.ariaDescribedBy}
              className={`${inputClassName} ${!state.sourceId ? "text-gray-400 dark:text-gray-500" : ""} ${source.message ? invalidInputClassName : ""}`}
            >
              <option value="" disabled hidden>
                Select a source…
              </option>
              {MOCK_BOOKING_SOURCES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {source.message ? (
              <p id="source-error" className={errorTextClassName}>
                {source.message}
              </p>
            ) : null}
          </div>
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-gray-100 pt-6 dark:border-gray-800">
        <legend className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
          Guest details
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="guest-full-name" className={labelClassName}>
              Full name <span className="text-error-500">*</span>
            </label>
            <input
              id="guest-full-name"
              type="text"
              value={state.guest.fullName}
              onChange={(event) => onGuestFieldChange("fullName", event.target.value)}
              placeholder="e.g. Nguyen Van A"
              aria-invalid={Boolean(fullName.message)}
              aria-describedby={fullName.ariaDescribedBy}
              className={`${inputClassName} ${fullName.message ? invalidInputClassName : ""}`}
            />
            {fullName.message ? (
              <p id="guest-full-name-error" className={errorTextClassName}>
                {fullName.message}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="guest-phone" className={labelClassName}>
              Phone number <span className="text-error-500">*</span>
            </label>
            <input
              id="guest-phone"
              type="tel"
              value={state.guest.phone}
              onChange={(event) => onGuestFieldChange("phone", event.target.value)}
              placeholder="e.g. 090 123 4567"
              maxLength={32}
              aria-invalid={Boolean(phone.message)}
              aria-describedby={phone.ariaDescribedBy}
              className={`${inputClassName} ${phone.message ? invalidInputClassName : ""}`}
            />
            {phone.message ? (
              <p id="guest-phone-error" className={errorTextClassName}>
                {phone.message}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="guest-email" className={labelClassName}>
              Email <span className="text-gray-400 dark:text-gray-500">(optional)</span>
            </label>
            <input
              id="guest-email"
              type="email"
              value={state.guest.email}
              onChange={(event) => onGuestFieldChange("email", event.target.value)}
              placeholder="e.g. guest@example.com"
              maxLength={256}
              aria-invalid={Boolean(email.message)}
              aria-describedby={email.ariaDescribedBy}
              className={`${inputClassName} ${email.message ? invalidInputClassName : ""}`}
            />
            {email.message ? (
              <p id="guest-email-error" className={errorTextClassName}>
                {email.message}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="guest-nationality" className={labelClassName}>
              Nationality <span className="text-gray-400 dark:text-gray-500">(optional)</span>
            </label>
            <select
              id="guest-nationality"
              value={state.guest.nationalityCode}
              onChange={(event) => onGuestFieldChange("nationalityCode", event.target.value)}
              className={inputClassName}
            >
              <option value="">Not specified</option>
              {MOCK_NATIONALITIES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.flag} {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>
    </div>
  );
};

export default GuestDetailsSection;
