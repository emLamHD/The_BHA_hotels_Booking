"use client";

import React, { useEffect, useRef } from "react";
import { InfoIcon } from "@/icons";
import { formatDisplayDate } from "@/components/calendar/reservation-board/dateMath";
import type { ReservationReviewData } from "./types";

const AMOUNT_FORMATTER = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const TITLE_ID = "reservation-review-title";
const DESCRIPTION_ID = "reservation-review-description";

interface ReservationReviewDialogProps {
  data: ReservationReviewData;
  onBackToEdit: () => void;
  onConfirm: () => void;
}

function occupancyLabel(adults: number, children: number): string {
  const adultsLabel = `${adults} adult${adults === 1 ? "" : "s"}`;
  return children > 0 ? `${adultsLabel} · ${children} child${children === 1 ? "" : "ren"}` : adultsLabel;
}

const ReservationReviewDialog: React.FC<ReservationReviewDialogProps> = ({
  data,
  onBackToEdit,
  onConfirm,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const backButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onBackToEdit();
      return;
    }
    if (event.key !== "Tab") return;

    const container = panelRef.current;
    if (!container) return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select, [href], input, [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-999999 flex items-center justify-center overflow-y-auto bg-gray-900/70 p-4 dark:bg-gray-950/80"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBackToEdit();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={DESCRIPTION_ID}
        onKeyDown={handleKeyDown}
        className="my-8 w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900 sm:p-6"
      >
        <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Review reservation
        </h3>
        <p id={DESCRIPTION_ID} className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Confirm the details below before creating this demo reservation.
        </p>

        <dl className="mt-4 space-y-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-sm dark:border-gray-800 dark:bg-white/[0.02]">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Property</dt>
            <dd className="text-right font-medium text-gray-800 dark:text-white/90">
              {data.propertyName}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Guest</dt>
            <dd className="text-right font-medium text-gray-800 dark:text-white/90">
              {data.guestName}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Phone</dt>
            <dd className="text-right font-medium text-gray-800 dark:text-white/90">
              {data.guestPhone}
            </dd>
          </div>
          {data.guestEmail ? (
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-gray-400">Email</dt>
              <dd className="text-right font-medium text-gray-800 dark:text-white/90">
                {data.guestEmail}
              </dd>
            </div>
          ) : null}
          {data.guestNationalityLabel ? (
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-gray-400">Nationality</dt>
              <dd className="text-right font-medium text-gray-800 dark:text-white/90">
                {data.guestNationalityLabel}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Source</dt>
            <dd className="text-right font-medium text-gray-800 dark:text-white/90">
              {data.sourceLabel}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Room units</dt>
            <dd className="text-right font-medium text-gray-800 dark:text-white/90">
              {data.units.length}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-col gap-3">
          {data.units.map((unit, index) => (
            <div
              key={unit.unitId}
              className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800"
            >
              <p className="mb-1 font-medium text-gray-800 dark:text-white/90">
                Room {index + 1} — {unit.soldRoomTypeName}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                Assigned: {unit.physicalRoomLabel}
              </p>
              {unit.crossesRoomType && unit.assignedRoomTypeName ? (
                <p className="mt-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
                  Sold RoomType: {unit.soldRoomTypeName}
                  <br />
                  Assigned PhysicalRoom type: {unit.assignedRoomTypeName}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {formatDisplayDate(unit.checkIn)} – {formatDisplayDate(unit.checkOut)} ·{" "}
                {unit.nights} night{unit.nights === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {occupancyLabel(unit.adults, unit.children)}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                Rate Plan: {unit.ratePlanName}
              </p>
              {unit.hasPriceOverride &&
              unit.ratePlanNightlyAmount !== null &&
              unit.effectiveNightlyAmount !== null ? (
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  Rate Plan price:{" "}
                  <span className="line-through">
                    {AMOUNT_FORMATTER.format(unit.ratePlanNightlyAmount)}
                  </span>{" "}
                  · Actual price:{" "}
                  <span className="font-medium text-gray-800 dark:text-white/90">
                    {AMOUNT_FORMATTER.format(unit.effectiveNightlyAmount)}
                  </span>
                </p>
              ) : null}
              {unit.subtotal !== null ? (
                <p className="mt-1 text-right text-sm font-medium text-gray-800 dark:text-white/90">
                  {AMOUNT_FORMATTER.format(unit.subtotal)}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-baseline justify-between rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <span className="text-sm text-gray-600 dark:text-gray-300">
            Aggregate estimated total
          </span>
          <span className="text-base font-semibold text-gray-800 dark:text-white/90">
            {AMOUNT_FORMATTER.format(data.aggregateTotal)}
          </span>
        </div>

        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Demo only — this reservation is not saved to the backend.
        </p>

        <div className="mt-5 flex justify-end gap-3">
          <button
            ref={backButtonRef}
            type="button"
            onClick={onBackToEdit}
            className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Back to edit
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            Confirm demo reservation
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReservationReviewDialog;
