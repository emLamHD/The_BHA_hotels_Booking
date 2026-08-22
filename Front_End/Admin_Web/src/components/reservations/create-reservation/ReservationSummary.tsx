"use client";

import React from "react";
import { formatDisplayDate } from "@/components/calendar/reservation-board/dateMath";
import type { ReservationReviewData } from "./types";

const AMOUNT_FORMATTER = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

interface ReservationSummaryProps {
  data: ReservationReviewData;
  onReview: () => void;
}

function occupancyLabel(adults: number, children: number): string {
  const adultsLabel = `${adults} adult${adults === 1 ? "" : "s"}`;
  return children > 0 ? `${adultsLabel} · ${children} child${children === 1 ? "" : "ren"}` : adultsLabel;
}

const ReservationSummary: React.FC<ReservationSummaryProps> = ({ data, onReview }) => {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        Reservation summary
      </h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Updates live as you fill out the form.
      </p>

      <dl className="mt-4 space-y-2 border-t border-gray-100 pt-4 text-sm dark:border-gray-800">
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

      <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
        {data.units.map((unit, index) => (
          <div
            key={unit.unitId}
            className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-xs dark:border-gray-800 dark:bg-white/[0.02]"
          >
            <p className="mb-1.5 text-sm font-medium text-gray-800 dark:text-white/90">
              Room {index + 1}
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              Sold: {unit.soldRoomTypeName ?? "— Select sold RoomType —"}
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              Assigned: {unit.physicalRoomLabel}
              {unit.crossesRoomType && unit.assignedRoomTypeName ? (
                <span className="text-amber-700 dark:text-amber-300">
                  {" "}
                  ({unit.assignedRoomTypeName} — differs from sold RoomType)
                </span>
              ) : null}
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              {unit.checkIn && unit.checkOut
                ? `${formatDisplayDate(unit.checkIn)} – ${formatDisplayDate(unit.checkOut)} · ${unit.nights} night${unit.nights === 1 ? "" : "s"}`
                : "Dates not set"}
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              {occupancyLabel(unit.adults, unit.children)}
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              Rate: {unit.ratePlanName ?? "— Select rate plan —"}
            </p>
            {unit.hasPriceOverride &&
            unit.ratePlanNightlyAmount !== null &&
            unit.effectiveNightlyAmount !== null ? (
              <p className="text-gray-600 dark:text-gray-300">
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
              <p className="mt-1 text-right font-medium text-gray-800 dark:text-white/90">
                {AMOUNT_FORMATTER.format(unit.subtotal)}{" "}
                <span className="text-[10px] font-normal text-gray-400 dark:text-gray-500">
                  demo estimate
                </span>
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-baseline justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
        <span className="text-sm text-gray-600 dark:text-gray-300">Estimated total</span>
        <span className="text-lg font-semibold text-gray-800 dark:text-white/90">
          {AMOUNT_FORMATTER.format(data.aggregateTotal)}
        </span>
      </div>
      <p className="mt-1 text-right text-[11px] text-gray-400 dark:text-gray-500">
        Demo estimate only — not authoritative pricing.
      </p>

      <button
        id="reservation-review-button"
        type="button"
        onClick={onReview}
        className="mt-5 h-11 w-full rounded-lg bg-brand-500 text-sm font-medium text-white hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        Review reservation
      </button>
    </div>
  );
};

export default ReservationSummary;
