"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDisplayDate } from "./dateMath";
import type {
  AssignedReservationItem,
  BookingSource,
  PaymentCollectionStatus,
  PhysicalRoom,
  RoomType,
  UnassignedReservationItem,
} from "./types";

interface ReservationHoverCardProps {
  item: AssignedReservationItem | UnassignedReservationItem;
  anchorEl: HTMLElement;
  bookingSources: BookingSource[];
  roomType: RoomType;
  physicalRoom: PhysicalRoom | null;
}

const CARD_WIDTH_PX = 264;
const VIEWPORT_MARGIN_PX = 8;
const ANCHOR_GAP_PX = 8;
const FALLBACK_CARD_HEIGHT_PX = 240;

const PAYMENT_STATUS_LABEL: Record<PaymentCollectionStatus, string> = {
  unpaid: "Chưa thu",
  deposit: "Đã đặt cọc",
  paid: "Đã thu đủ",
};

const PAYMENT_STATUS_CLASSNAME: Record<PaymentCollectionStatus, string> = {
  unpaid: "bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-400",
  deposit: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  paid: "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-400",
};

const AMOUNT_FORMATTER = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

function occupancyLabel(adults: number, children: number): string {
  const adultsLabel = `${adults} người lớn`;
  return children > 0 ? `${adultsLabel} · ${children} trẻ em` : adultsLabel;
}

const ReservationHoverCard: React.FC<ReservationHoverCardProps> = ({
  item,
  anchorEl,
  bookingSources,
  roomType,
  physicalRoom,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: -9999,
    left: -9999,
    width: CARD_WIDTH_PX,
    visibility: "hidden",
  });

  // This component only ever mounts client-side, in response to a pointer
  // or focus event on a timeline bar — never during SSR or initial
  // hydration — so no separate mount-detection gate is needed before using
  // `document`/`window` here.
  useLayoutEffect(() => {
    const anchorRect = anchorEl.getBoundingClientRect();
    const cardHeight = cardRef.current?.offsetHeight ?? FALLBACK_CARD_HEIGHT_PX;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = anchorRect.left;
    left = Math.min(left, viewportWidth - CARD_WIDTH_PX - VIEWPORT_MARGIN_PX);
    left = Math.max(VIEWPORT_MARGIN_PX, left);

    let top = anchorRect.bottom + ANCHOR_GAP_PX;
    if (top + cardHeight + VIEWPORT_MARGIN_PX > viewportHeight) {
      const above = anchorRect.top - ANCHOR_GAP_PX - cardHeight;
      top = above >= VIEWPORT_MARGIN_PX
        ? above
        : Math.max(VIEWPORT_MARGIN_PX, viewportHeight - cardHeight - VIEWPORT_MARGIN_PX);
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- position the portal only after measuring its rendered size against the anchor's DOM rect; cannot be computed during render.
    setStyle({ position: "fixed", top, left, width: CARD_WIDTH_PX, visibility: "visible" });
  }, [anchorEl, item.id]);

  const source = bookingSources.find((candidate) => candidate.id === item.sourceId);
  const paymentStatus = item.paymentDisplay.status;
  const locationLabel = physicalRoom
    ? `${roomType.name} · Room ${physicalRoom.code}`
    : `${roomType.name} · Unassigned`;

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      className="pointer-events-none fixed z-99999 rounded-xl border border-gray-200 bg-white p-3.5 text-xs shadow-theme-lg dark:border-gray-800 dark:bg-gray-900"
      style={style}
    >
      <p className="truncate text-sm font-semibold text-gray-800 dark:text-white/90">
        {item.guestName} <span aria-hidden="true">{item.nationality.flag}</span>
      </p>
      <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
        {item.nationality.label}
      </p>

      <p className="mt-1.5 truncate text-[11px] text-gray-500 dark:text-gray-400">
        {locationLabel}
      </p>

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className={`inline-flex size-5 shrink-0 items-center justify-center rounded text-[9px] font-bold ${
            source?.markClassName ?? "bg-gray-400 text-white"
          }`}
          aria-hidden="true"
        >
          {source?.markLabel ?? "?"}
        </span>
        <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
          {source?.label ?? item.sourceId}
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-gray-100 pt-2.5 dark:border-gray-800">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Check-in
          </p>
          <p className="font-medium text-success-600 dark:text-success-400">
            {formatDisplayDate(item.startDate)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Checkout
          </p>
          <p className="font-medium text-error-600 dark:text-error-400">
            {formatDisplayDate(item.endDate)}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
        {occupancyLabel(item.occupancy.adults, item.occupancy.children)}
      </p>

      <div className="mt-2.5 border-t border-gray-100 pt-2.5 dark:border-gray-800">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${PAYMENT_STATUS_CLASSNAME[paymentStatus]}`}
        >
          {PAYMENT_STATUS_LABEL[paymentStatus]}
        </span>
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Số tiền phải thu</span>
          <span className="whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-white/90">
            {AMOUNT_FORMATTER.format(item.paymentDisplay.amountDue)}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ReservationHoverCard;
