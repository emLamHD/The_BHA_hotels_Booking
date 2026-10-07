"use client";

/**
 * PMS-CAL-001.3-CP04: the confirmation dialog for lifting one operational
 * block on the server-backed Reservation Board — built from an authoritative
 * `BlockCancelTarget` (`blockCancelTarget.ts`) and rendering its result through
 * `describeBlockCancelOutcome` below. It follows the write-dialog rules of
 * `ReservationUnassignDialog.tsx` exactly:
 *
 * - It is inert about everything else: it does not call the API client (the
 *   caller's `onSubmit` does, and supplies `expectedVersion` from the same
 *   target), does not re-read the board, creates no reconciliation entry and
 *   never patches the board optimistically.
 * - At most one request on the wire. `inFlightRef` is set synchronously, before
 *   the first `await`, so a double click or a held Enter that dispatches
 *   several submit events in one render still starts exactly one request.
 * - While a request is in flight the dialog cannot be closed (Escape, backdrop
 *   and both Close controls are inert): closing would suggest the request was
 *   cancelled, and it would not be — the server may still commit.
 * - After a success, conflict or unconfirmed (`unknown`) result Confirm is gone
 *   for good. Only outcomes that prove nothing was written (`not-sent`, `400`)
 *   may send again. A throwing `onSubmit` is treated as `unknown`, since the
 *   request may have been sent.
 *
 * Unlike the create dialog there is no form to fill and therefore no review
 * step: the segment to cancel is fully determined by the bar that was clicked,
 * so the only free field is an optional reason. What the operator confirms is
 * shown verbatim from the board — in particular the segment's **own full
 * `[startDate, endDate)`**, never the part of it the current date range happens
 * to display. A block may extend past the visible window in either direction,
 * and cancelling it lifts all of its nights, so showing the clipped bar range
 * here would misstate what the confirmation does.
 *
 * Focus starts on Close — never on the destructive action, so a stray Enter
 * cannot cancel a block — is kept inside with Tab/Shift+Tab, and moves to the
 * result when one appears. Like the unassign dialog it does not restore focus
 * to an opener itself: it is opened from a popover that unmounts in the same
 * commit, so the parent (`ReservationBoard.tsx`) owns a stable opener and
 * restores focus from `onClose`.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { CloseLineIcon } from "@/icons";
import type { OperationalBlockCancelOutcome } from "@/lib/api/client";
import type { AssignmentOutcomeView } from "./assignmentOutcome";
import type { BoardReloadStatus } from "./ReservationAssignmentDialog";
import type { BlockCancelTarget } from "./blockCancelTarget";
import { diffDaysIso } from "./dateMath";

/**
 * What the operator is told after one block-cancel attempt. Same two rules as
 * `describeBlockCreateOutcome`: nothing is claimed that was not observed, and
 * sending again is offered only when the server proved nothing was written.
 */
export function describeBlockCancelOutcome(outcome: OperationalBlockCancelOutcome): AssignmentOutcomeView {
  switch (outcome.kind) {
    case "cancelled":
      return { tone: "success", title: "Operational block cancelled.", reloadBoard: true, allowResubmit: false };
    case "not-sent":
      return {
        tone: "error",
        title: "The request was not sent. Nothing was changed.",
        detail: outcome.message,
        reloadBoard: false,
        allowResubmit: true,
      };
    case "rejected":
      switch (outcome.category) {
        case "validation":
          return {
            tone: "error",
            title: "The server did not accept this cancellation. Nothing was changed.",
            detail: outcome.detail,
            reloadBoard: false,
            allowResubmit: true,
          };
        case "not-permitted":
          return {
            tone: "error",
            // Never worded as though the block had already been lifted: a
            // closed gate answers 404 with an empty body, and so does a
            // segment this Property does not own.
            title: "Cancelling operational blocks is not available from this Admin session. Nothing was changed.",
            detail:
              outcome.status === 404
                ? "Writes may be disabled on this API host, or this segment is not an operational block of this Property. The block has not been reported as cancelled."
                : "The server refused this write.",
            reloadBoard: false,
            allowResubmit: false,
          };
        case "conflict":
          return {
            tone: "warning",
            title:
              "This block was not cancelled: it has already changed on the server since the board was read. Review the reloaded board before trying again.",
            detail: outcome.detail,
            reloadBoard: true,
            allowResubmit: false,
          };
        case "refused":
        default:
          return {
            tone: "error",
            title: `The server refused the request (HTTP ${outcome.status}). Nothing was changed.`,
            detail: outcome.detail,
            reloadBoard: false,
            allowResubmit: false,
          };
      }
    case "unknown":
    default: {
      const cause =
        outcome.reason === "timeout"
          ? "The server did not respond in time."
          : outcome.reason === "server-error"
            ? `The server returned an unexpected response${outcome.status ? ` (HTTP ${outcome.status})` : ""}.`
            : outcome.reason === "aborted"
              ? "The request was interrupted after it was sent."
              : "The connection to the Admin API failed.";
      return {
        tone: "warning",
        title:
          "The result could not be confirmed — the block may or may not have been cancelled. It was not sent again, and this room stays locked for these nights until the board is read again.",
        detail: cause,
        reloadBoard: true,
        allowResubmit: false,
      };
    }
  }
}

function reloadStatusText(status: BoardReloadStatus, resolution?: "unresolved" | "observed"): string {
  if (resolution === "observed") {
    // Carefully weaker than "it worked": the segment is gone or re-versioned,
    // which is a fact about the schedule, not about this request's effect.
    return "This block is no longer shown at the version this request targeted. That shows the schedule changed; it does not prove this request cancelled it.";
  }
  if (resolution === "unresolved" && status === "done") {
    return "The board was checked and this block is still shown unchanged. That does not prove the request failed. Close this dialog and use Check again.";
  }
  if (status === "failed") return "The board could not be reloaded. Close this dialog and use Retry on the board.";
  if (status === "done") return "The board has been reloaded from the server.";
  if (status === "elsewhere") {
    return "The view changed before the board was reloaded; the board this block was cancelled from has not been re-read yet.";
  }
  return "Reloading the board from the server…";
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ReservationBlockCancelDialogProps {
  target: BlockCancelTarget;
  /** State of the board re-read triggered by this dialog's last outcome, if any. */
  boardReloadStatus: BoardReloadStatus;
  /** What the server's data says about a cancel whose response was lost. */
  uncertainResolution?: "unresolved" | "observed";
  /** `reason` is omitted when blank, and already trimmed otherwise. */
  onSubmit: (reason?: string) => Promise<OperationalBlockCancelOutcome>;
  onClose: () => void;
}

const ReservationBlockCancelDialog: React.FC<ReservationBlockCancelDialogProps> = ({
  target,
  boardReloadStatus,
  uncertainResolution,
  onSubmit,
  onClose,
}) => {
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
  const { block } = target;
  const nights = diffDaysIso(block.startDate, block.endDate);

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

    let outcome: OperationalBlockCancelOutcome;
    try {
      outcome = await onSubmit(trimmedReason === "" ? undefined : trimmedReason);
    } catch {
      // onSubmit is not expected to throw; if it does, the request may have been sent.
      outcome = { kind: "unknown", reason: "network" };
    }

    const view = describeBlockCancelOutcome(outcome);
    // Refs first and unconditionally, so the guards stay correct even if the
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
              Cancel operational block
            </h3>
            <p id={descriptionId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              This lifts the whole block shown below, returning every one of its nights to usable capacity. The block
              is not deleted: it is recorded as cancelled, with its history kept. Nothing is changed until you confirm.
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
              <SummaryRow label="Property" value={target.propertyName} />
              <SummaryRow label="Room" value={target.roomNumber} />
              <SummaryRow
                label="Nights [start, end)"
                value={`[${block.startDate}, ${block.endDate}) · ${nights} ${nights === 1 ? "night" : "nights"}`}
                mono
              />
              <SummaryRow label="Current reason" value={block.reason} />
              {/* Shown so the operator can tie this confirmation to one exact
                  segment version, the same pair that is sent as expectedVersion. */}
              <SummaryRow label="Segment" value={`${block.segmentId} · v${block.segmentVersion}`} mono />
            </dl>

            <div>
              <label htmlFor={reasonId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                Reason for cancelling (optional)
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
                Recorded with this cancellation if you enter one. It does not replace the block&apos;s own reason above.
              </p>
            </div>

            {pending && (
              <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                Cancelling the block… waiting for the server. This dialog stays open until the server responds.
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
                className="rounded-lg bg-error-500 px-4 py-2 text-sm font-medium text-white hover:bg-error-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              >
                {pending ? "Cancelling…" : `Cancel block on room ${target.roomNumber}`}
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

export default ReservationBlockCancelDialog;
