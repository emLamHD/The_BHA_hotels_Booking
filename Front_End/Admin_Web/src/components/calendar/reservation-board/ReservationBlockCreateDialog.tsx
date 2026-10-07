"use client";

/**
 * PMS-CAL-001.3-CP03: the dialog that creates one operational block — one
 * Active PhysicalRoom, one half-open night range `[startDate, endDate)` and a
 * required reason — on the server-backed Reservation Board. It follows the
 * write-dialog rules of `ReservationUnassignDialog.tsx`:
 *
 * - Two steps. The operator fills the form, then reviews exactly what will be
 *   sent; only the reviewed values are posted, never the live form fields.
 *   Closing before confirming sends nothing.
 * - At most one request on the wire (`inFlightRef` is set before the first
 *   `await`), and the dialog cannot be closed while it is in flight.
 * - After a conflict or an unconfirmed (`unknown`) result it can never send
 *   again; only outcomes that prove nothing was written (`not-sent`, `400`)
 *   return to the form for a deliberate correction.
 *
 * The date range is limited to the board window `[boardFrom, boardTo)` that
 * was on screen when the dialog opened, so the operator can verify the result
 * on that same board. That is a limit of this UI slice, not a backend rule.
 * The 366-night cap and the 500-character reason are the API's own limits.
 * Nothing here guesses whether the room is free: capacity and overlap are the
 * server's decisions, reported back as `409`.
 *
 * The board owns the re-read and the reconciliation; this dialog only renders
 * the `boardReloadStatus`/`uncertainResolution` it is given.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { CloseLineIcon } from "@/icons";
import type { OperationalBlockCreateOutcome } from "@/lib/api/client";
import type { CreateOperationalBlockRequest } from "@/lib/api/types";
import type { AssignmentOutcomeView } from "./assignmentOutcome";
import type { BoardReloadStatus } from "./ReservationAssignmentDialog";
import { addDaysIso, diffDaysIso, formatIsoDate, parseIsoDate } from "./dateMath";

export interface BlockCreateRoomOption {
  id: string;
  roomNumber: string;
  roomTypeName: string;
}

/** Everything the dialog may offer, taken from the board on screen when it opened. */
export interface BlockCreateDialogTarget {
  propertyId: string;
  propertyName: string;
  boardKey: string;
  boardFrom: string;
  /** Exclusive. */
  boardTo: string;
  /** Active rooms of the Property only. */
  rooms: BlockCreateRoomOption[];
}

export const MAX_BLOCK_NIGHTS = 366;
export const MAX_BLOCK_REASON_LENGTH = 500;

/**
 * What the operator is told after one block-create attempt. Same two rules as
 * `assignmentOutcome.ts`: nothing is claimed that was not observed, and
 * sending again is offered only when the server proved nothing was written
 * and a corrected request could succeed.
 */
export function describeBlockCreateOutcome(outcome: OperationalBlockCreateOutcome): AssignmentOutcomeView {
  switch (outcome.kind) {
    case "created":
      return { tone: "success", title: "Operational block created.", reloadBoard: true, allowResubmit: false };
    case "not-sent":
      return {
        tone: "error",
        title: "The request was not sent. Nothing was saved.",
        detail: outcome.message,
        reloadBoard: false,
        allowResubmit: true,
      };
    case "rejected":
      switch (outcome.category) {
        case "validation":
          return {
            tone: "error",
            title: "The server did not accept this block. Nothing was saved. Correct it and review again.",
            detail: outcome.detail,
            reloadBoard: false,
            allowResubmit: true,
          };
        case "not-permitted":
          return {
            tone: "error",
            title: "Creating operational blocks is not available from this Admin session. Nothing was saved.",
            detail:
              outcome.status === 404
                ? "Writes may be disabled on this API host, or the room is not part of this Property."
                : "The server refused this write.",
            reloadBoard: false,
            allowResubmit: false,
          };
        case "conflict":
          return {
            tone: "warning",
            title:
              "This block was not saved: the room cannot be blocked for these nights as the schedule stands now. Review the reloaded board before trying again.",
            detail: outcome.detail,
            reloadBoard: true,
            allowResubmit: false,
          };
        case "refused":
        default:
          return {
            tone: "error",
            title: `The server refused the request (HTTP ${outcome.status}). Nothing was saved.`,
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
          "The result could not be confirmed — the block may or may not have been saved. It was not sent again, and this room stays locked for these nights until the board shows the block.",
        detail: cause,
        reloadBoard: true,
        allowResubmit: false,
      };
    }
  }
}

function reloadStatusText(status: BoardReloadStatus, resolution?: "unresolved" | "observed"): string {
  if (resolution === "observed") {
    return "A block for this room over exactly these nights is now shown on the server. That shows the schedule; it does not prove this request created it.";
  }
  if (resolution === "unresolved" && status === "done") {
    return "The board was checked and no matching block is shown yet. That does not prove the request failed. Close this dialog and use Check again.";
  }
  if (status === "failed") return "The board could not be reloaded. Close this dialog and use Retry on the board.";
  if (status === "done") return "The board has been reloaded from the server.";
  if (status === "elsewhere") {
    return "The view changed before the board was reloaded; the board this block was created from has not been re-read yet.";
  }
  return "Reloading the board from the server…";
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseIsoDate(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return formatIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) === value;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ReservationBlockCreateDialogProps {
  target: BlockCreateDialogTarget;
  boardReloadStatus: BoardReloadStatus;
  uncertainResolution?: "unresolved" | "observed";
  /** True while an unconfirmed earlier create for this room overlaps these nights. */
  isRangeLocked: (physicalRoomId: string, startDate: string, endDate: string) => boolean;
  onSubmit: (request: CreateOperationalBlockRequest) => Promise<OperationalBlockCreateOutcome>;
  onClose: () => void;
}

const ReservationBlockCreateDialog: React.FC<ReservationBlockCreateDialogProps> = ({
  target,
  boardReloadStatus,
  uncertainResolution,
  isRangeLocked,
  onSubmit,
  onClose,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const roomId = useId();
  const startId = useId();
  const endId = useId();
  const reasonId = useId();

  const [physicalRoomId, setPhysicalRoomId] = useState("");
  const [startDate, setStartDate] = useState(target.boardFrom);
  const [endDate, setEndDate] = useState(() => addDaysIso(target.boardFrom, 1));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  /** The exact request under review; `null` while editing. */
  const [confirmed, setConfirmed] = useState<CreateOperationalBlockRequest | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AssignmentOutcomeView | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const roomSelectRef = useRef<HTMLSelectElement>(null);
  const errorsRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const submitLockedRef = useRef(false);
  const closeRequestedRef = useRef(false);
  const mountedRef = useRef(true);

  const locked = result !== null && !result.allowResubmit;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (result) resultRef.current?.focus();
    else if (errors.length > 0) errorsRef.current?.focus();
    else if (confirmed) reviewRef.current?.focus();
    else roomSelectRef.current?.focus();
  }, [result, errors, confirmed]);

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

  const validate = (): string[] => {
    const problems: string[] = [];
    if (!target.rooms.some((room) => room.id === physicalRoomId)) problems.push("Choose an Active room.");
    const startValid = isIsoDate(startDate);
    const endValid = isIsoDate(endDate);
    if (!startValid) problems.push("Enter a valid first blocked night.");
    if (!endValid) problems.push("Enter a valid end date.");
    if (startValid && endValid) {
      if (startDate >= endDate) {
        problems.push("The end date must be after the first blocked night.");
      } else if (diffDaysIso(startDate, endDate) > MAX_BLOCK_NIGHTS) {
        problems.push(`A block may cover at most ${MAX_BLOCK_NIGHTS} nights.`);
      }
      if (startDate < target.boardFrom || endDate > target.boardTo) {
        problems.push(
          `Choose nights within the board on screen, [${target.boardFrom}, ${target.boardTo}), so the result can be checked there.`
        );
      }
    }
    const trimmed = reason.trim();
    if (trimmed === "") problems.push("Enter a reason.");
    else if (trimmed.length > MAX_BLOCK_REASON_LENGTH) {
      problems.push(`The reason may be at most ${MAX_BLOCK_REASON_LENGTH} characters.`);
    }
    if (problems.length === 0 && isRangeLocked(physicalRoomId, startDate, endDate)) {
      problems.push(
        "An earlier request to block this room on overlapping nights is still unconfirmed. Check the board again before creating another."
      );
    }
    return problems;
  };

  const handleReview = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlightRef.current || submitLockedRef.current) return;
    const problems = validate();
    setResult(null);
    setErrors(problems);
    if (problems.length > 0) return;
    setConfirmed({ physicalRoomId, startDate, endDate, reason: reason.trim() });
  };

  const handleConfirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlightRef.current || submitLockedRef.current || !confirmed) return;
    // Re-checked at send time: a lock may have appeared since the review.
    if (isRangeLocked(confirmed.physicalRoomId, confirmed.startDate, confirmed.endDate)) {
      setConfirmed(null);
      setErrors([
        "An earlier request to block this room on overlapping nights is still unconfirmed. Check the board again before creating another.",
      ]);
      return;
    }

    inFlightRef.current = true;
    setPending(true);
    setResult(null);

    let outcome: OperationalBlockCreateOutcome;
    try {
      outcome = await onSubmit(confirmed);
    } catch {
      // onSubmit is not expected to throw; if it does, the request may have been sent.
      outcome = { kind: "unknown", reason: "network" };
    }

    const view = describeBlockCreateOutcome(outcome);
    submitLockedRef.current = !view.allowResubmit;
    inFlightRef.current = false;
    if (!mountedRef.current) return;
    setPending(false);
    setResult(view);
    // A refusal that proves nothing was written returns to the form, values kept.
    if (view.allowResubmit) setConfirmed(null);
  };

  const room = confirmed ? target.rooms.find((candidate) => candidate.id === confirmed.physicalRoomId) : undefined;
  const nights = confirmed ? diffDaysIso(confirmed.startDate, confirmed.endDate) : 0;
  const inputClass =
    "h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-800 read-only:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

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
              Create operational block
            </h3>
            <p id={descriptionId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Takes one Active room of {target.propertyName} out of service for the nights you choose. The server
              decides whether the room can be blocked; nothing is saved until you confirm.
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            aria-disabled={pending}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:hover:bg-white/5"
          >
            <CloseLineIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={confirmed ? handleConfirm : handleReview}
          aria-busy={pending}
          className="flex min-h-0 flex-1 flex-col"
          noValidate
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {confirmed ? (
              <div ref={reviewRef} tabIndex={-1} className="focus:outline-hidden" aria-label="Review block">
                <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">Review before creating:</p>
                <dl className="space-y-2 text-sm">
                  <SummaryRow label="Property" value={target.propertyName} />
                  <SummaryRow label="Room" value={room ? `${room.roomNumber} (${room.roomTypeName})` : confirmed.physicalRoomId} />
                  <SummaryRow
                    label="Nights [start, end)"
                    value={`[${confirmed.startDate}, ${confirmed.endDate}) · ${nights} ${nights === 1 ? "night" : "nights"}`}
                    mono
                  />
                  <SummaryRow label="Reason" value={confirmed.reason} />
                </dl>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor={roomId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Room
                  </label>
                  <select
                    id={roomId}
                    ref={roomSelectRef}
                    value={physicalRoomId}
                    disabled={locked}
                    onChange={(event) => setPhysicalRoomId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Choose an Active room…</option>
                    {target.rooms.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.roomNumber} ({option.roomTypeName})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={startId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                      First blocked night
                    </label>
                    <input
                      id={startId}
                      type="date"
                      value={startDate}
                      min={target.boardFrom}
                      readOnly={locked}
                      onChange={(event) => setStartDate(event.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor={endId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                      End date (exclusive)
                    </label>
                    <input
                      id={endId}
                      type="date"
                      value={endDate}
                      max={target.boardTo}
                      readOnly={locked}
                      onChange={(event) => setEndDate(event.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  The room is blocked from the first night up to, but not including, the end date — within the board
                  on screen, [{target.boardFrom}, {target.boardTo}).
                </p>
                <div>
                  <label htmlFor={reasonId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Reason
                  </label>
                  <textarea
                    id={reasonId}
                    value={reason}
                    readOnly={locked}
                    maxLength={MAX_BLOCK_REASON_LENGTH}
                    onChange={(event) => setReason(event.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  />
                </div>
              </>
            )}

            {errors.length > 0 && (
              <div
                ref={errorsRef}
                tabIndex={-1}
                role="alert"
                className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-800 focus:outline-hidden dark:bg-error-500/10 dark:text-error-300"
              >
                <ul className="list-inside list-disc space-y-0.5">
                  {errors.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}

            {pending && (
              <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                Creating the block… waiting for the server. This dialog stays open until the server responds.
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
            {confirmed && !locked && (
              <button
                type="button"
                onClick={() => {
                  if (inFlightRef.current) return;
                  setConfirmed(null);
                  setErrors([]);
                }}
                aria-disabled={pending}
                className="mr-auto rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/5"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={requestClose}
              aria-disabled={pending}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
            >
              Close
            </button>
            {!locked && (
              <button
                type="submit"
                aria-disabled={pending}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              >
                {pending ? "Creating…" : confirmed ? "Create block" : "Review"}
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

export default ReservationBlockCreateDialog;
