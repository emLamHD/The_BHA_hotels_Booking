"use client";

import React, { useRef } from "react";
import { CalenderIcon } from "@/icons";

interface ReservationDateFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: string;
  max: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

const inputClassName =
  "h-11 w-full rounded-lg border border-gray-300 bg-white pl-3 pr-11 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-white/[0.02]";
const invalidInputClassName =
  "border-error-300 focus:border-error-300 focus:ring-error-500/10 dark:border-error-500/60";
const labelClassName = "mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300";
const errorTextClassName = "mt-1.5 text-xs text-error-600 dark:text-error-400";

/**
 * Reusable safe date field (ADMIN-002.1-C5 §4.1): a native `<input
 * type="date">` plus a dedicated calendar-icon button that attempts
 * `HTMLInputElement.showPicker()` directly from the user's click. Falls back
 * to focusing the input for browsers without `showPicker()` — no date-picker
 * dependency is added.
 */
const ReservationDateField: React.FC<ReservationDateFieldProps> = ({
  id,
  label,
  value,
  onChange,
  min,
  max,
  error,
  required,
  disabled,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const errorId = `${id}-error`;

  const openPicker = () => {
    const input = inputRef.current;
    if (!input || disabled) return;
    const showPicker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker;
    if (typeof showPicker === "function") {
      try {
        showPicker.call(input);
        return;
      } catch {
        // Some browsers throw when showPicker() isn't called from a direct
        // user gesture context — fall back to focusing the input below.
      }
    }
    input.focus();
    input.click();
  };

  return (
    <div>
      <label htmlFor={id} className={labelClassName}>
        {label} {required ? <span className="text-error-500">*</span> : null}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="date"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={`${inputClassName} ${error ? invalidInputClassName : ""}`}
        />
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          aria-label={`Open calendar picker for ${label}`}
          className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/5 dark:hover:text-gray-300"
        >
          <CalenderIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className={errorTextClassName}>
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default ReservationDateField;
