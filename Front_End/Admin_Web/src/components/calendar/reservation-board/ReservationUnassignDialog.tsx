"use client";

/**
 * PMS-CAL-001.2-CP04D.4B: the confirmation dialog for removing the room
 * assignment of one assigned segment on the server-backed Reservation Board —
 * built from an authoritative `UnassignTarget` (`unassignTarget.ts`, CP04D.2)
 * and rendering its result through `describeUnassignOutcome`
 * (`assignmentOutcome.ts`, CP04D.4A). It is deliberately inert about
 * everything else: it does not call the API client (the caller's `onSubmit`
 * does, in CP04D.4C, and supplies `expectedVersion` from the same target), does
 * not re-read the board, creates no reconciliation entry and patches nothing
 * optimistically. It is not mounted anywhere yet.
 *
 * An unassign removes one room assignment only. The Reservation, its stay
 * dates, rates and commercial snapshot are untouched, and an unassign has no
 * destination, so there is no RoomType choice and no cross-RoomType wording.
 *
 * Submission guarantees — the same as `ReservationMoveDialog.tsx`:
 * - At most one request on the wire. `inFlightRef` is set synchronously,
 *   before the first `await`, so a double click or a held Enter that
 *   dispatches several submit events inside one render starts one request.
 * - While a request is in flight the dialog cannot be closed (Escape,
 *   backdrop and the Close buttons are inert): closing would suggest the
 *   request was cancelled, and it would not be — the server may still commit.
 * - After a success, conflict or unconfirmed (`unknown`) result Confirm is
 *   gone for good; only `allowResubmit` outcomes may send again. A throwing
 *   `onSubmit` is treated as `unknown`, since the request may have been sent.
 *
 * Focus: it starts on Close — never on the destructive action, so a stray
 * Enter cannot unassign — is kept inside with Tab/Shift+Tab, and moves to the
 * result when one appears. Like `ReservationMoveDialog.tsx` it does not try to
 * restore focus to an "opener" itself: it is opened from a popover that
 * unmounts in the same commit, so `document.activeElement` would already be
 * `document.body`. The parent (`ReservationBoard.tsx`, CP04D.4C) owns a stable
 * opener and restores focus from `onClose`, which is called at most once.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { CloseLineIcon } from "@/icons";
import type { UnassignAssignmentOutcome } from "@/lib/api/client";
import { describeUnassignOutcome, type AssignmentOutcomeView } from "./assignmentOutcome";
import { diffDaysIso } from "./dateMath";
import type { UnassignTarget } from "./unassignTarget";

interface ReservationUnassignDialogProps {
  target: UnassignTarget;
  /** `reason` is omitted when blank, and already trimmed otherwise. */
  onSubmit: (reason?: string) => Promise<UnassignAssignmentOutcome>;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ReservationUnassignDialog: React.FC<ReservationUnassignDialogProps> = ({ target, onSubmit, onClose }) => {
  const titleId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const reasonHintId = useId();

  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AssignmentOutcomeView | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  /** A request is on the wire: nothing may close the dialog or send again. */
  const inFlightRef = useRef(false);
  /** A terminal outcome was reached: sending again from this dialog is never allowed. */
  const submitLockedRef = useRef(false);
  const closeRequestedRef = useRef(false);
  const mountedRef = useRef(true);

  const canSubmit = result === null || result.allowResubmit;
  const nights = diffDaysIso(target.segment.startDate, target.segment.endDate);

  useEffect(() => {
    mountedRef.current = true;
    closeButtonRef.current?.focus();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  const requestClose = useCallback(() => {
    if (inFlightRef.current || closeRequestedRef.current) return;
    closeRequestedRef.current = true;
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

    const trimmedReason = reason.trim();
    inFlightRef.current = true;
    setPending(true);
    setResult(null);

    let outcome: UnassignAssignmentOutcome;
    try {
      outcome = await onSubmit(trimmedReason === "" ? undefined : trimmedReason);
    } catch {
      // onSubmit is not expected to throw; if it does, the request may have been sent.
      outcome = { kind: "unknown", reason: "network" };
    }

    const view = describeUnassignOutcome(outcome);
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
              Remove room assignment
            </h3>
            <p id={descriptionId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              This removes only the room assignment of this segment, so the nights below become unassigned. The
              reservation still exists: it is not cancelled or deleted, and its stay dates, rates and commercial
              snapshot are not changed.
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
              <SummaryRow label="Current room" value={`${target.currentRoomNumber} (${target.currentRoomTypeName})`} />
              <SummaryRow
                label="Range [start, end)"
                value={`[${target.segment.startDate}, ${target.segment.endDate}) · ${nights} ${nights === 1 ? "night" : "nights"}`}
                mono
              />
            </dl>

            <div>
              <label htmlFor={reasonId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                Reason (optional)
              </label>
              <textarea
                id={reasonId}
                value={reason}
                readOnly={pending || !canSubmit}
                onChange={(event) => {
                  if (inFlightRef.current) return;
                  setReason(event.target.value);
                }}
                aria-describedby={reasonHintId}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
              <p id={reasonHintId} className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Recorded with this change if you enter one. It is not required.
              </p>
            </div>

            {pending && (
              <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                Removing the room assignment… waiting for the server. This dialog stays open until the server responds.
              </p>
            )}

            {result && (
              <div
                ref={resultRef}
                tabIndex={-1}
                role={result.tone === "success" ? "status" : "alert"}
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
                className="rounded-lg bg-error-500 px-4 py-2 text-sm font-medium text-white hover:bg-error-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              >
                {pending ? "Removing…" : `Remove room ${target.currentRoomNumber} assignment`}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
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

export default ReservationUnassignDialog;
