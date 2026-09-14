"use client";

/**
 * PMS-CAL-001.2-CP03A: assign one visible unassigned range of one
 * ReservationUnit to one Active PhysicalRoom of the same sold RoomType.
 *
 * The dialog owns only interaction state. It never edits board data: the
 * outcome is reported back to `ReservationBoard`, which re-reads the
 * authoritative board from the backend.
 *
 * Submission guarantees:
 * - At most one request on the wire at a time. `inFlightRef` is set
 *   synchronously, before the first await, so a double click or a held Enter
 *   that dispatches several submit events inside one render cannot start a
 *   second request; the `pending` state only drives what is shown. Sending
 *   again is possible only after an outcome that proves nothing was written
 *   (a `400`, or a request that never left the browser).
 * - While a request is in flight the dialog cannot be closed (Escape, backdrop
 *   and the Close button are inert). Closing mid-request would suggest the
 *   write was cancelled, and it would not be — the server may still commit.
 *   The client-side timeout bounds that wait.
 * - After a conflict or an unconfirmed result, Confirm is gone for good: the
 *   selection may already be applied or stale, so the operator returns to the
 *   reloaded board rather than re-sending.
 *
 * Focus is moved into the dialog on open, kept inside it with Tab/Shift+Tab,
 * and returned to the element that opened it on close when that element still
 * exists.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { CloseLineIcon } from "@/icons";
import type { AssignmentCreateOutcome } from "@/lib/api/client";
import { describeAssignmentOutcome, type AssignmentOutcomeView } from "./assignmentOutcome";
import type { AssignmentTarget } from "./assignmentTarget";
import { diffDaysIso, formatDisplayDate } from "./dateMath";

export type BoardReloadStatus = "idle" | "pending" | "done" | "failed";

interface ReservationAssignmentDialogProps {
  target: AssignmentTarget;
  /** State of the board re-read triggered by this dialog's last outcome, if any. */
  boardReloadStatus: BoardReloadStatus;
  onSubmit: (physicalRoomId: string) => Promise<AssignmentCreateOutcome>;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ReservationAssignmentDialog: React.FC<ReservationAssignmentDialogProps> = ({
  target,
  boardReloadStatus,
  onSubmit,
  onClose,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const roomErrorId = useId();
  const roomGroupName = useId();
  const roomLegendId = useId();

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomError, setRoomError] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AssignmentOutcomeView | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRoomRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  /** A request is on the wire: nothing may close the dialog or send again. */
  const inFlightRef = useRef(false);
  /** A terminal outcome was reached: sending again from this dialog is never allowed. */
  const submitLockedRef = useRef(false);
  const mountedRef = useRef(true);

  const { stay, unassignedRange, candidateRooms } = target;
  const nights = diffDaysIso(unassignedRange.startDate, unassignedRange.endDate);
  const stayNights = diffDaysIso(stay.checkIn, stay.checkOut);
  const isPartial = unassignedRange.startDate !== stay.checkIn || unassignedRange.endDate !== stay.checkOut;
  const canSubmit = candidateRooms.length > 0 && (result === null || result.allowResubmit);
  const selectedRoom = candidateRooms.find((room) => room.id === selectedRoomId) ?? null;

  // Open: remember the opener and move focus in. Close: hand focus back.
  useEffect(() => {
    mountedRef.current = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (firstRoomRef.current ?? closeButtonRef.current)?.focus();
    return () => {
      mountedRef.current = false;
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  const requestClose = useCallback(() => {
    if (inFlightRef.current) return;
    onClose();
  }, [onClose]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlightRef.current || submitLockedRef.current || !canSubmit) return;
    if (!selectedRoomId) {
      setRoomError(true);
      firstRoomRef.current?.focus();
      return;
    }

    inFlightRef.current = true;
    setPending(true);
    setResult(null);

    let outcome: AssignmentCreateOutcome;
    try {
      outcome = await onSubmit(selectedRoomId);
    } catch {
      // onSubmit is not expected to throw; if it does, the request may have been sent.
      outcome = { kind: "unknown", reason: "network" };
    }

    const view = describeAssignmentOutcome(outcome);
    // Refs first and unconditionally, so the guards are correct even if the
    // board unmounted this dialog while the request was in flight.
    submitLockedRef.current = !view.allowResubmit;
    inFlightRef.current = false;
    if (!mountedRef.current) return;
    setPending(false);
    setResult(view);
  };

  return (
    <div
      className="fixed inset-0 z-9999999 flex items-center justify-center bg-gray-900/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl dark:bg-gray-900"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h3 id={titleId} className="text-base font-semibold text-gray-800 dark:text-white/90">
              Assign room
            </h3>
            <p id={descriptionId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Assigns only these nights of this reservation unit to a room of its sold room type. Stay dates,
              rates, cancellation terms and the booking itself are not changed.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={requestClose}
            aria-label="Close"
            aria-disabled={pending}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:hover:bg-white/5"
          >
            <CloseLineIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} aria-busy={pending} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <dl className="space-y-2 text-sm">
              <SummaryRow label="Guest" value={stay.guestDisplayName} />
              <SummaryRow label="Confirmation #" value={stay.confirmationNumber} />
              <SummaryRow label="Reservation unit" value={stay.reservationUnitId} mono />
              <SummaryRow label="Property" value={target.propertyName} />
              <SummaryRow label="Sold room type" value={target.soldRoomTypeName} />
              <SummaryRow
                label="Nights to assign"
                value={`${formatDisplayDate(unassignedRange.startDate)} → ${formatDisplayDate(unassignedRange.endDate)}`}
              />
              <SummaryRow
                label="Range [start, end)"
                value={`[${unassignedRange.startDate}, ${unassignedRange.endDate}) · ${nights} ${nights === 1 ? "night" : "nights"}`}
                mono
              />
              <SummaryRow
                label="Stay"
                value={`${formatDisplayDate(stay.checkIn)} → ${formatDisplayDate(stay.checkOut)} · ${stayNights} ${stayNights === 1 ? "night" : "nights"}`}
              />
            </dl>

            {isPartial && (
              <p className="rounded-lg bg-blue-light-50 px-3 py-2 text-xs text-blue-light-700 dark:bg-blue-light-500/10 dark:text-blue-light-300">
                Partial assignment: only the {nights} {nights === 1 ? "night" : "nights"} in this range are assigned.
                The end date is the morning after the last night and is not included. Other nights of the stay are
                not changed.
              </p>
            )}

            {candidateRooms.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-white/5 dark:text-gray-300">
                No active {target.soldRoomTypeName} room is available on this board to assign.
              </p>
            ) : (
              <fieldset disabled={!canSubmit}>
                <legend id={roomLegendId} className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                  Target room ({target.soldRoomTypeName})
                </legend>
                <div
                  role="radiogroup"
                  aria-labelledby={roomLegendId}
                  aria-required="true"
                  aria-invalid={roomError || undefined}
                  aria-describedby={roomError ? roomErrorId : undefined}
                  className="max-h-56 space-y-1.5 overflow-y-auto pr-1"
                >
                  {candidateRooms.map((room, index) => (
                    <label
                      key={room.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm has-checked:border-brand-500 has-checked:bg-brand-50 has-disabled:cursor-not-allowed dark:border-gray-700 dark:has-checked:bg-brand-500/10"
                    >
                      <input
                        ref={index === 0 ? firstRoomRef : undefined}
                        type="radio"
                        name={roomGroupName}
                        value={room.id}
                        checked={selectedRoomId === room.id}
                        onChange={() => {
                          // Not disabled while pending, so focus is never dropped out of the
                          // dialog mid-request; the choice is simply frozen instead.
                          if (inFlightRef.current) return;
                          setSelectedRoomId(room.id);
                          setRoomError(false);
                        }}
                        className="size-4 accent-brand-500"
                      />
                      <span className="font-medium text-gray-800 dark:text-white/90">Room {room.roomNumber}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">Floor {room.floor}</span>
                    </label>
                  ))}
                </div>
                {roomError && (
                  <p id={roomErrorId} role="alert" className="mt-2 text-xs text-error-600 dark:text-error-400">
                    Select a room to assign.
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  Availability is checked by the server when you confirm.
                </p>
              </fieldset>
            )}

            {pending && (
              <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                Assigning{selectedRoom ? ` room ${selectedRoom.roomNumber}` : ""}… waiting for the server. This
                dialog stays open until the server responds.
              </p>
            )}

            {result && (
              <div
                ref={resultRef}
                tabIndex={-1}
                role="alert"
                className={`rounded-lg px-3 py-2 text-sm focus:outline-hidden ${
                  result.tone === "warning"
                    ? "bg-warning-50 text-warning-800 dark:bg-warning-500/10 dark:text-warning-300"
                    : result.tone === "success"
                      ? "bg-success-50 text-success-800 dark:bg-success-500/10 dark:text-success-300"
                      : "bg-error-50 text-error-800 dark:bg-error-500/10 dark:text-error-300"
                }`}
              >
                <p className="font-medium">{result.title}</p>
                {result.detail && <p className="mt-1 text-xs">{result.detail}</p>}
                {result.reloadBoard && <ReloadStatusLine status={boardReloadStatus} />}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
            <button
              type="button"
              onClick={requestClose}
              aria-disabled={pending}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
            >
              Close
            </button>
            {canSubmit && (
              <button
                type="submit"
                aria-disabled={pending}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              >
                {pending ? "Assigning…" : selectedRoom ? `Assign room ${selectedRoom.roomNumber}` : "Assign room"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

const ReloadStatusLine: React.FC<{ status: BoardReloadStatus }> = ({ status }) => {
  if (status === "failed") {
    return <p className="mt-1 text-xs">The board could not be reloaded. Close this dialog and use Retry on the board.</p>;
  }
  if (status === "done") {
    return <p className="mt-1 text-xs">The board has been reloaded from the server.</p>;
  }
  return <p className="mt-1 text-xs">Reloading the board from the server…</p>;
};

const SummaryRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-baseline justify-between gap-4">
    <dt className="shrink-0 text-gray-400 dark:text-gray-500">{label}</dt>
    <dd
      className={`min-w-0 text-right font-medium break-all text-gray-700 dark:text-gray-200 ${mono ? "font-mono text-xs" : ""}`}
    >
      {value}
    </dd>
  </div>
);

export default ReservationAssignmentDialog;
