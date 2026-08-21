"use client";

import React, { useEffect, useRef } from "react";
import { ArrowRightIcon, InfoIcon } from "@/icons";
import { formatDisplayDate } from "./dateMath";
import type { ReservationMoveIntent } from "./types";

interface ReservationMoveConfirmDialogProps {
  intent: ReservationMoveIntent;
  onConfirm: () => void;
  onCancel: () => void;
}

const TITLE_ID = "reservation-move-confirm-title";
const DESCRIPTION_ID = "reservation-move-confirm-description";

const ReservationMoveConfirmDialog: React.FC<ReservationMoveConfirmDialogProps> = ({
  intent,
  onConfirm,
  onCancel,
}) => {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [cancelButtonRef.current, confirmButtonRef.current].filter(
      (element): element is HTMLButtonElement => element !== null
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

  const stayDatesLabel = `${formatDisplayDate(intent.startDate)} – ${formatDisplayDate(intent.endDate)}`;

  return (
    <div
      className="fixed inset-0 z-999999 flex items-center justify-center bg-gray-900/70 p-4 dark:bg-gray-950/80"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={DESCRIPTION_ID}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900 sm:p-6"
      >
        <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Confirm room move
        </h3>
        <p id={DESCRIPTION_ID} className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Move {intent.guestName}&apos;s reservation ({stayDatesLabel}
          {intent.sourceLabel ? `, ${intent.sourceLabel}` : ""}) to a different room?
        </p>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <span className="block text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              From
            </span>
            <span className="mt-1 block text-sm font-medium text-gray-800 dark:text-white/90">
              Room {intent.fromRoomCode}
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {intent.fromRoomTypeName}
            </span>
          </div>

          <ArrowRightIcon
            className="size-4 shrink-0 text-gray-400 dark:text-gray-500"
            aria-hidden="true"
          />

          <div className="rounded-lg border border-brand-300 bg-brand-50 p-3 dark:border-brand-500/40 dark:bg-brand-500/10">
            <span className="block text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">
              To
            </span>
            <span className="mt-1 block text-sm font-medium text-gray-800 dark:text-white/90">
              Room {intent.toRoomCode}
            </span>
            <span className="block text-xs text-gray-600 dark:text-gray-300">
              {intent.toRoomTypeName}
            </span>
          </div>
        </div>

        {intent.crossesRoomType ? (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
            Room type change: {intent.fromRoomTypeName} → {intent.toRoomTypeName}
          </p>
        ) : null}

        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Demo only — this move is not saved to the backend.
        </p>

        <div className="mt-5 flex justify-end gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            Confirm move
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReservationMoveConfirmDialog;
