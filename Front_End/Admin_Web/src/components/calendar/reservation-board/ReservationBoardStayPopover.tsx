"use client";

/**
 * PMS-CAL-001.1: a small details panel. Shows only fields the Admin
 * Reservation Board API actually returns — never a fake email/phone/
 * nationality/source/payment/lifecycle timestamp (FRONTEND INTEGRATION
 * CONTRACT item 11). Unavailable data is simply not shown here, rather than
 * invented.
 *
 * PMS-CAL-001.2-CP04C.5: the one exception to "read-only" is the `Move room`
 * action offered for an assigned-bar selection that carries a `segment`
 * (CP04C.2) — this panel never performs the move itself; it only reports the
 * exact clicked segment back to `ReservationBoard.tsx`, which decides
 * whether that selection still matches the authoritative board
 * (`buildMoveTarget`) before ever opening a write dialog.
 */

import React from "react";
import { CloseLineIcon } from "@/icons";
import { formatDisplayDate } from "./dateMath";
import type { AssignedSegmentSelection, StaySelection, BlockSelection } from "./ReservationBoardServerTimeline";

const COVERAGE_LABEL: Record<string, string> = {
  FullyAssigned: "Fully assigned",
  PartiallyAssigned: "Partially assigned",
  FullyUnassigned: "Fully unassigned",
};

interface ReservationBoardStayPopoverProps {
  selection: { kind: "stay"; value: StaySelection } | { kind: "block"; value: BlockSelection };
  onClose: () => void;
  /** Present only when this selection came from an assigned bar (carries `segment`). */
  onMoveRoom?: (selection: AssignedSegmentSelection) => void;
  /** True while the board is stale or this exact segment already has an unresolved move outstanding. */
  moveBlocked?: boolean;
}

const ReservationBoardStayPopover: React.FC<ReservationBoardStayPopoverProps> = ({
  selection,
  onClose,
  onMoveRoom,
  moveBlocked = false,
}) => {
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
            {selection.value.segment && onMoveRoom && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => onMoveRoom({ stay: selection.value.stay, segment: selection.value.segment! })}
                  disabled={moveBlocked}
                  aria-disabled={moveBlocked}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
                >
                  Move room
                </button>
                {moveBlocked && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    Refreshing from the server, or this segment already has an unresolved move — try again once it
                    settles.
                  </p>
                )}
              </div>
            )}
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
