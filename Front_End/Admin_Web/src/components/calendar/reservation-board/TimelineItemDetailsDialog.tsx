"use client";

import React, { useEffect, useRef } from "react";
import { CloseLineIcon, InfoIcon } from "@/icons";
import { diffDaysIso, formatDisplayDate } from "./dateMath";
import type {
  BookingSource,
  PaymentCollectionStatus,
  PhysicalRoom,
  ReservationStayStatus,
  RoomType,
  TimelineItem,
} from "./types";

interface TimelineItemDetailsDialogProps {
  item: TimelineItem;
  physicalRooms: PhysicalRoom[];
  roomTypes: RoomType[];
  bookingSources: BookingSource[];
  onClose: () => void;
  onRequestMove: (itemId: string) => void;
}

const TITLE_ID = "timeline-item-details-title";

const AMOUNT_FORMATTER = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const PAYMENT_STATUS_LABEL: Record<PaymentCollectionStatus, string> = {
  unpaid: "Unpaid",
  deposit: "Deposit paid",
  paid: "Paid in full",
};

const PAYMENT_STATUS_CLASSNAME: Record<PaymentCollectionStatus, string> = {
  unpaid: "bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-400",
  deposit: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  paid: "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-400",
};

const STAY_STATUS_LABEL: Record<ReservationStayStatus, string> = {
  confirmed: "Not checked in",
  "checked-in": "Checked in",
  "checked-out": "Checked out",
};

const STAY_STATUS_CLASSNAME: Record<ReservationStayStatus, string> = {
  confirmed: "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300",
  "checked-in": "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300",
  "checked-out": "bg-gray-100 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400",
};

function nightsLabel(nights: number): string {
  return `${nights} night${nights === 1 ? "" : "s"}`;
}

function occupancyLabel(adults: number, children: number): string {
  const adultsLabel = `${adults} adult${adults === 1 ? "" : "s"}`;
  return children > 0 ? `${adultsLabel} · ${children} child${children === 1 ? "" : "ren"}` : adultsLabel;
}

const fieldLabelClassName = "text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500";
const fieldValueClassName = "text-sm font-medium text-gray-800 dark:text-white/90";

const TimelineItemDetailsDialog: React.FC<TimelineItemDetailsDialogProps> = ({
  item,
  physicalRooms,
  roomTypes,
  bookingSources,
  onClose,
  onRequestMove,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
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

  const durationNights = diffDaysIso(item.startDate, item.endDate);
  const room =
    item.kind === "assigned-reservation" || item.kind === "operational-block"
      ? physicalRooms.find((candidate) => candidate.id === item.roomId) ?? null
      : null;
  const roomType =
    (room && roomTypes.find((candidate) => candidate.id === room.roomTypeId)) ??
    (item.kind !== "operational-block"
      ? roomTypes.find((candidate) => candidate.id === item.soldRoomTypeId) ?? null
      : null);

  if (item.kind === "operational-block") {
    return (
      <div
        className="fixed inset-0 z-999999 flex items-center justify-center overflow-y-auto bg-gray-900/70 p-4 dark:bg-gray-950/80"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          onKeyDown={handleKeyDown}
          className="my-8 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900 sm:p-6"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Operational block
            </h3>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-white/5 dark:hover:text-gray-300"
            >
              <CloseLineIcon className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
            <div>
              <p className={fieldLabelClassName}>Note / type</p>
              <p className={fieldValueClassName}>{item.reason}</p>
            </div>
            <div>
              <p className={fieldLabelClassName}>Room</p>
              <p className={fieldValueClassName}>
                {room ? `Room ${room.code}` : "—"}
                {roomType ? ` · ${roomType.name}` : ""}
              </p>
            </div>
            <div>
              <p className={fieldLabelClassName}>Start</p>
              <p className={fieldValueClassName}>{formatDisplayDate(item.startDate)}</p>
            </div>
            <div>
              <p className={fieldLabelClassName}>End</p>
              <p className={fieldValueClassName}>{formatDisplayDate(item.endDate)}</p>
            </div>
            <div>
              <p className={fieldLabelClassName}>Duration</p>
              <p className={fieldValueClassName}>{nightsLabel(durationNights)}</p>
            </div>
          </div>

          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Demo only — not saved to the backend.
          </p>

          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => onRequestMove(item.id)}
              className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              Move block
            </button>
          </div>
        </div>
      </div>
    );
  }

  const source = bookingSources.find((candidate) => candidate.id === item.sourceId);
  const physicalRoomLabel = room ? `Room ${room.code}` : "Unassigned";
  const soldRoomType = roomTypes.find((candidate) => candidate.id === item.soldRoomTypeId) ?? null;

  return (
    <div
      className="fixed inset-0 z-999999 flex items-center justify-center overflow-y-auto bg-gray-900/70 p-4 dark:bg-gray-950/80"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        onKeyDown={handleKeyDown}
        className="my-8 w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {item.guestName}
            </h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{item.reservationCode}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-white/5 dark:hover:text-gray-300"
          >
            <CloseLineIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STAY_STATUS_CLASSNAME[item.stayStatus]}`}
          >
            {STAY_STATUS_LABEL[item.stayStatus]}
          </span>
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${PAYMENT_STATUS_CLASSNAME[item.paymentDisplay.status]}`}
          >
            {PAYMENT_STATUS_LABEL[item.paymentDisplay.status]}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <div>
            <p className={fieldLabelClassName}>Phone</p>
            <p className={fieldValueClassName}>{item.guestPhone}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Nationality</p>
            <p className={fieldValueClassName}>
              <span aria-hidden="true">{item.nationality.flag}</span> {item.nationality.label}
            </p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Booking source</p>
            <p className={fieldValueClassName}>{source?.label ?? item.sourceId}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Occupancy</p>
            <p className={fieldValueClassName}>
              {occupancyLabel(item.occupancy.adults, item.occupancy.children)}
            </p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Sold room type</p>
            <p className={fieldValueClassName}>{soldRoomType?.name ?? "—"}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Assigned room</p>
            <p className={fieldValueClassName}>{physicalRoomLabel}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Check-in</p>
            <p className={fieldValueClassName}>
              {formatDisplayDate(item.startDate)} · {item.checkInTime}
            </p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Checkout</p>
            <p className={fieldValueClassName}>
              {formatDisplayDate(item.endDate)} · {item.checkOutTime}
            </p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Nights</p>
            <p className={fieldValueClassName}>{nightsLabel(durationNights)}</p>
          </div>
          <div>
            <p className={fieldLabelClassName}>Payment amount due</p>
            <p className={fieldValueClassName}>
              {AMOUNT_FORMATTER.format(item.paymentDisplay.amountDue)}
            </p>
          </div>
        </div>

        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Demo only — not saved to the backend.
        </p>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => onRequestMove(item.id)}
            className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            Move / adjust stay
          </button>
        </div>
      </div>
    </div>
  );
};

export default TimelineItemDetailsDialog;
