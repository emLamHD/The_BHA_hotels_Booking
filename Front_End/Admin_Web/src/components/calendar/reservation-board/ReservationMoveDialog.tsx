"use client";

/**
 * PMS-CAL-001.2-CP04C.4: the real move dialog for an assigned segment on the
 * server-backed Reservation Board — built from an authoritative `MoveTarget`
 * (`moveTarget.ts`, CP04C.2), submitting through `moveReservationAssignment`
 * (`client.ts`, CP04C.1). Deliberately separate from the pre-existing
 * `ReservationMoveConfirmDialog.tsx`, which stays mock-data-only ("Demo
 * only — this move is not saved to the backend.") and is never touched or
 * reused here — the two operate on incompatible data shapes and only one of
 * them writes anything real.
 *
 * This checkpoint offers only a same-sold-RoomType destination: every
 * candidate this dialog renders is filtered to `isSameSoldType === true`
 * (the source room is already excluded upstream by `buildMoveTarget`), no
 * date may be changed, and no cross-RoomType confirmation/reason UI exists
 * here at all — that is a later checkpoint's scope, exactly as CP03A shipped
 * same-RoomType assignment before CP03B added the cross-RoomType path.
 *
 * PMS-CAL-001.2-CP04C.5: now mounted from `ReservationBoard.tsx`.
 * `boardReloadStatus`/`uncertainResolution` mirror
 * `ReservationAssignmentDialog.tsx`'s own props of the same names exactly —
 * the board owns the actual re-read and reconciliation tracking; this dialog
 * only renders what it is told, so a conflict or lost-response result never
 * sits next to stale "reloading…" text.
 *
 * Submission guarantees — identical in spirit to `ReservationAssignmentDialog.tsx`:
 * - At most one request on the wire at a time. `inFlightRef` is set
 *   synchronously, before the first `await`, so a double click or a held
 *   Enter that dispatches several submit events inside one render cannot
 *   start a second request.
 * - While a request is in flight the dialog cannot be closed (Escape,
 *   backdrop and the Close button are inert): closing mid-request would
 *   suggest the write was cancelled, and it would not be — the server may
 *   still commit.
 * - After a conflict or an unconfirmed (`unknown`) result, Confirm is gone
 *   for good: the selection may already be applied or stale, so the
 *   operator returns to the reloaded board rather than re-sending.
 * - Selecting a different room clears any prior result, so a stale outcome
 *   from a previous selection is never shown next to a new one.
 *
 * Focus is moved into the dialog on open, kept inside it with Tab/Shift+Tab,
 * and returned to the element that opened it on close when that element
 * still exists.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { CloseLineIcon } from "@/icons";
import type { MoveAssignmentOutcome } from "@/lib/api/client";
import { describeMoveOutcome, type AssignmentOutcomeView } from "./assignmentOutcome";
import { diffDaysIso } from "./dateMath";
import type { MoveTarget } from "./moveTarget";
import type { BoardReloadStatus } from "./ReservationAssignmentDialog";

interface ReservationMoveDialogProps {
  target: MoveTarget;
  /** State of the board re-read triggered by this dialog's last outcome, if any. */
  boardReloadStatus: BoardReloadStatus;
  /** What the server's data says about a move whose response was lost. */
  uncertainResolution?: "unresolved" | "observed" | "changed";
  onSubmit: (physicalRoomId: string) => Promise<MoveAssignmentOutcome>;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ReservationMoveDialog: React.FC<ReservationMoveDialogProps> = ({
  target,
  boardReloadStatus,
  uncertainResolution,
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

  const sameSoldTypeCandidates = target.candidateRooms.filter((room) => room.isSameSoldType);
  const canSubmit = sameSoldTypeCandidates.length > 0 && (result === null || result.allowResubmit);
  const selectedRoom = sameSoldTypeCandidates.find((room) => room.id === selectedRoomId) ?? null;
  const nights = diffDaysIso(target.segment.startDate, target.segment.endDate);

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

  const selectRoom = (roomId: string) => {
    if (inFlightRef.current) return;
    setSelectedRoomId(roomId);
    setRoomError(false);
    setResult(null);
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

    let outcome: MoveAssignmentOutcome;
    try {
      outcome = await onSubmit(selectedRoomId);
    } catch {
      // onSubmit is not expected to throw; if it does, the request may have been sent.
      outcome = { kind: "unknown", reason: "network" };
    }

    const view = describeMoveOutcome(outcome);
    // Refs first and unconditionally, so the guards are correct even if the
    // caller unmounted this dialog while the request was in flight.
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
              Move room
            </h3>
            <p id={descriptionId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Moves this segment to another room of the same sold room type. The stay dates, rate and booking are not
              changed.
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
              <SummaryRow label="Guest" value={target.stay.guestDisplayName} />
              <SummaryRow label="Confirmation #" value={target.stay.confirmationNumber} />
              <SummaryRow label="Reservation unit" value={target.stay.reservationUnitId} mono />
              <SummaryRow label="Property" value={target.propertyName} />
              <SummaryRow label="Sold room type" value={target.soldRoomTypeName} />
              <SummaryRow
                label="Current room"
                value={`${target.currentRoomNumber} (${target.currentRoomTypeName})`}
              />
              <SummaryRow
                label="Range [start, end)"
                value={`[${target.segment.startDate}, ${target.segment.endDate}) · ${nights} ${nights === 1 ? "night" : "nights"}`}
                mono
              />
            </dl>

            {sameSoldTypeCandidates.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-white/5 dark:text-gray-300">
                No other Active room of this room type is available to move to on this Property.
              </p>
            ) : (
              <fieldset disabled={!canSubmit}>
                <legend id={roomLegendId} className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                  Destination room
                </legend>
                <div
                  role="radiogroup"
                  aria-labelledby={roomLegendId}
                  aria-required="true"
                  aria-invalid={roomError || undefined}
                  aria-describedby={roomError ? roomErrorId : undefined}
                  className="max-h-64 space-y-1.5 overflow-y-auto pr-1"
                >
                  {sameSoldTypeCandidates.map((room, index) => (
                    <RoomOption
                      key={room.id}
                      room={room}
                      name={roomGroupName}
                      checked={selectedRoomId === room.id}
                      onSelect={selectRoom}
                      inputRef={index === 0 ? firstRoomRef : undefined}
                    />
                  ))}
                </div>
                {roomError && (
                  <p id={roomErrorId} role="alert" className="mt-2 text-xs text-error-600 dark:text-error-400">
                    Select a room to move to.
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  Availability is checked by the server when you confirm.
                </p>
              </fieldset>
            )}

            {pending && (
              <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                Moving{selectedRoom ? ` to room ${selectedRoom.roomNumber}` : ""}… waiting for the server. This
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
                {result.reloadBoard && (
                  <p className="mt-1 text-xs">{reloadStatusText(boardReloadStatus, uncertainResolution)}</p>
                )}
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
                {pending ? "Moving…" : selectedRoom ? `Move to room ${selectedRoom.roomNumber}` : "Move room"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

const RoomOption: React.FC<{
  room: MoveTarget["candidateRooms"][number];
  name: string;
  checked: boolean;
  onSelect: (roomId: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}> = ({ room, name, checked, onSelect, inputRef }) => (
  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm has-checked:border-brand-500 has-checked:bg-brand-50 has-disabled:cursor-not-allowed dark:border-gray-700 dark:has-checked:bg-brand-500/10">
    <input
      ref={inputRef}
      type="radio"
      name={name}
      value={room.id}
      checked={checked}
      onChange={() => onSelect(room.id)}
      className="size-4 accent-brand-500"
    />
    <span className="font-medium text-gray-800 dark:text-white/90">Room {room.roomNumber}</span>
    <span className="text-xs text-gray-500 dark:text-gray-400">Floor {room.floor}</span>
  </label>
);

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

/**
 * PMS-CAL-001.2-CP04C.5: the condensed equivalent of
 * `ReservationAssignmentDialog.tsx`'s `ReloadStatusLine`/`UncertainStatusLine`
 * pair — same fallthrough order (observed → changed → checked-but-unshown →
 * plain reload status), returned as text rather than a second `role="alert"`
 * element, since it renders inside the result panel's own alert region here.
 */
function reloadStatusText(status: BoardReloadStatus, resolution?: "unresolved" | "observed" | "changed"): string {
  if (resolution !== undefined) {
    if (resolution === "observed") return "The destination now shown on the server matches this move.";
    if (resolution === "changed") {
      return "This segment has since changed on the server, so this request can no longer take effect. Its own result was never confirmed.";
    }
    if (status === "done") {
      return "The board was checked, but the destination is not shown yet. The result is still unknown; this segment stays locked. Close this dialog and use Check again.";
    }
  }
  if (status === "failed") return "The board could not be reloaded. Close this dialog and use Retry on the board.";
  if (status === "done") return "The board has been reloaded from the server.";
  if (status === "elsewhere") {
    return "The view changed before the board was reloaded; the result has not been re-read yet.";
  }
  return "Reloading the board from the server…";
}

export default ReservationMoveDialog;
