"use client";

/**
 * PMS-CAL-001.1: a small, strictly read-only details panel. Shows only
 * fields the Admin Reservation Board API actually returns — never a fake
 * email/phone/nationality/source/payment/lifecycle timestamp (FRONTEND
 * INTEGRATION CONTRACT item 11). Unavailable data is simply not shown here,
 * rather than invented.
 */

import React from "react";
import { CloseLineIcon } from "@/icons";
import { formatDisplayDate } from "./dateMath";
import type { StaySelection, BlockSelection } from "./ReservationBoardServerTimeline";

const COVERAGE_LABEL: Record<string, string> = {
  FullyAssigned: "Fully assigned",
  PartiallyAssigned: "Partially assigned",
  FullyUnassigned: "Fully unassigned",
};

interface ReservationBoardStayPopoverProps {
  selection: { kind: "stay"; value: StaySelection } | { kind: "block"; value: BlockSelection };
  onClose: () => void;
}

const ReservationBoardStayPopover: React.FC<ReservationBoardStayPopoverProps> = ({ selection, onClose }) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={selection.kind === "stay" ? "Reservation details" : "Operational block details"}
      className="fixed inset-0 z-9999999 flex items-center justify-center bg-gray-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
            {selection.kind === "stay" ? "Reservation" : "Operational block"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
          >
            <CloseLineIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        {selection.kind === "stay" ? (
          <dl className="space-y-2.5 text-sm">
            <Row label="Guest" value={selection.value.stay.guestDisplayName} />
            <Row label="Confirmation #" value={selection.value.stay.confirmationNumber} />
            <Row
              label="Stay"
              value={`${formatDisplayDate(selection.value.stay.checkIn)} – ${formatDisplayDate(selection.value.stay.checkOut)}`}
            />
            <Row label="Sold room type" value={selection.value.roomTypeName} />
            {selection.value.actualRoomTypeName &&
              selection.value.actualRoomTypeName !== selection.value.roomTypeName && (
                <Row label="Assigned room type" value={selection.value.actualRoomTypeName} />
              )}
            <Row
              label="Coverage"
              value={COVERAGE_LABEL[selection.value.stay.coverageStatus] ?? selection.value.stay.coverageStatus}
            />
            <p className="pt-2 text-xs text-gray-400 dark:text-gray-500">
              Contact details, payment/folio, and lifecycle timestamps are not recorded by this read-only view.
            </p>
          </dl>
        ) : (
          <dl className="space-y-2.5 text-sm">
            <Row label="Room" value={selection.value.roomNumber} />
            <Row
              label="Dates"
              value={`${formatDisplayDate(selection.value.block.startDate)} – ${formatDisplayDate(selection.value.block.endDate)}`}
            />
            <Row label="Reason" value={selection.value.block.reason} />
          </dl>
        )}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-4">
    <dt className="shrink-0 text-gray-400 dark:text-gray-500">{label}</dt>
    <dd className="text-right font-medium text-gray-700 dark:text-gray-200">{value}</dd>
  </div>
);

export default ReservationBoardStayPopover;
