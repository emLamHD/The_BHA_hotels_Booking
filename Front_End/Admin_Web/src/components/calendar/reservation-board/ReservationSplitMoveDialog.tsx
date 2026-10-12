"use client";

/**
 * PMS-CAL-002-CP04: the split-move dialog — one assigned segment is split at a date: its own room
 * keeps `[start, splitDate)` and a destination room takes `[splitDate, end)`. It is built from an
 * authoritative `SplitMoveTarget` (`splitMoveTarget.ts`, CP03) and is **not mounted anywhere** in
 * this checkpoint: no board, popover or page renders it, and it never calls the API. It hands a
 * validated {@link SplitMoveIntent} to `onSubmit`; the parent (CP05) owns the send — building the
 * request from the target's Property, segment id and version, the live capabilities, the room/night
 * locks and the pending-write record — and answers with a `SplitMoveAssignmentOutcome`. Deliberately
 * separate from the mock-only `ReservationMoveConfirmDialog.tsx` and from `ReservationMoveDialog.tsx`.
 *
 * Owner decisions applied (design §8): D1 a prefix that is already in a room of another RoomType than
 * sold needs a Manager, confirmation and a reason exactly as a cross-type destination does; D2 the
 * source room is never offered as the destination; D3 the reason is optional unless a part crosses;
 * D4 (approved 2026-10-12) a split date before the Property's `localToday` is allowed but needs its own
 * acknowledgement; D6 (approved 2026-10-12) there is no check-in/lifecycle or repricing rule — the stay
 * dates, prices and booking are untouched, and this dialog says nothing more about them.
 *
 * Authority and safety, in the order they are applied:
 * - Dates are real Gregorian dates 0001–9999 (`splitMoveDates.ts`); never the browser clock or
 *   timezone. The picker's `min`/`max` are a convenience — `handleSubmit` validates again.
 * - The destination, the cross-RoomType need and the past-date need are derived from the target on every
 *   render and re-checked in the handler: a permission prop lowered while the dialog is open, a
 *   destination that is no longer offered, or a target that has changed under the dialog sends nothing.
 * - Cross-RoomType is judged against the SOLD RoomType for both parts: the prefix uses the source room's
 *   RoomType from the board, the suffix the destination's — never a position, a stale segment field or a
 *   callback value.
 * - One request at a time: `inFlightRef` is set synchronously before the first `await`. While it is on
 *   the wire nothing can be edited and nothing can close the dialog (closing would suggest a
 *   cancellation, and the server may still commit). A throw from `onSubmit` is an unconfirmed result,
 *   never "not sent".
 * - After a terminal outcome (saved, conflict, refused, unconfirmed) Confirm is gone for good and stays
 *   gone through edits, re-renders and board reloads. Only "not sent", a validation 400 and a store
 *   cross-RoomType 403 for a role that may confirm can be sent again, and only by an explicit new Confirm.
 * - Unmounting while a request is in flight sets no state and does not call `onClose`: the request
 *   belongs to the parent, and the dialog going away is not a cancellation.
 *
 * Focus moves into the dialog on open (the date picker, or Close when nothing can be edited) and is kept
 * inside it with Tab/Shift+Tab. Restoring focus to the opener belongs to the parent, as for the move dialog.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { CloseLineIcon } from "@/icons";
import type { SplitMoveAssignmentOutcome } from "@/lib/api/client";
import { describeSplitMoveOutcome, type AssignmentOutcomeView } from "./assignmentOutcome";
import {
  checkSplitDate,
  compareSplitDateToToday,
  countNights,
  defaultSplitDate,
  shiftIsoDate,
  splitDateBounds,
} from "./splitMoveDates";
import { gregorianDayNumber, type SplitMoveTarget } from "./splitMoveTarget";
import type { BoardReloadStatus } from "./ReservationAssignmentDialog";

/** The backend's limit on a reason (`SchedulingFieldLimits.Reason`), counted in characters. */
export const SPLIT_MOVE_REASON_MAX_LENGTH = 500;

/**
 * What the operator chose, already validated. The parent builds the request from the target and live
 * state; nothing here names a Property, segment, version, actor, role or evidence. `pastDateAcknowledged`
 * is a UI-only fact (D4) and is not part of the API body.
 */
export interface SplitMoveIntent {
  splitDate: string;
  destinationPhysicalRoomId: string;
  /** True exactly when the prefix or the suffix is outside the sold RoomType. */
  confirmCrossRoomType: boolean;
  /** Trimmed; absent when blank. */
  reason?: string;
  /** True only when `splitDate` is before the Property's `localToday` and the operator acknowledged it. */
  pastDateAcknowledged: boolean;
}

interface ReservationSplitMoveDialogProps {
  target: SplitMoveTarget;
  /** State of the board re-read triggered by this dialog's last outcome, if any. */
  boardReloadStatus: BoardReloadStatus;
  /** What the server's data says about a split-move whose response was lost. */
  uncertainResolution?: "unresolved" | "observed" | "changed";
  /** The caller may change assignments at this Property. Omitted means no: nothing can be sent. */
  assignmentWriteEnabled?: boolean;
  /** The caller may confirm a cross-RoomType placement (Manager). Omitted means no. */
  crossRoomTypeEnabled?: boolean;
  onSubmit: (intent: SplitMoveIntent) => Promise<SplitMoveAssignmentOutcome>;
  onClose: () => void;
}

type FieldErrors = {
  date?: string;
  room?: string;
  cross?: string;
  reason?: string;
  ack?: string;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What identifies the source segment: a different value means this dialog's choices were made for another segment. */
const targetKey = (target: SplitMoveTarget): string =>
  [
    target.propertyId,
    target.segment.segmentId,
    target.segment.segmentVersion,
    target.segment.physicalRoomId,
    target.segment.startDate,
    target.segment.endDate,
  ].join("|");

const nightsLabel = (count: number): string => `${count} ${count === 1 ? "night" : "nights"}`;

const ReservationSplitMoveDialog: React.FC<ReservationSplitMoveDialogProps> = ({
  target,
  boardReloadStatus,
  uncertainResolution,
  assignmentWriteEnabled = false,
  crossRoomTypeEnabled = false,
  onSubmit,
  onClose,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const dateId = useId();
  const dateHelpId = useId();
  const dateErrorId = useId();
  const roomLegendId = useId();
  const roomGroupName = useId();
  const roomErrorId = useId();
  const crossConfirmErrorId = useId();
  const ackErrorId = useId();
  const reasonId = useId();
  const reasonHelpId = useId();
  const reasonErrorId = useId();

  const { segment } = target;
  const soldRoomTypeId = target.stay.soldRoomTypeId;
  const bounds = splitDateBounds(segment.startDate, segment.endDate);
  const sourceNights = countNights(segment.startDate, segment.endDate);
  const localTodayValid = gregorianDayNumber(target.localToday) !== null;

  const [openedForKey] = useState(() => targetKey(target));
  const [splitDate, setSplitDate] = useState(() => defaultSplitDate(segment.startDate, segment.endDate, target.localToday));
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [crossConfirmed, setCrossConfirmed] = useState(false);
  const [pastAcknowledged, setPastAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AssignmentOutcomeView | null>(null);
  const [outcomeKind, setOutcomeKind] = useState<SplitMoveAssignmentOutcome["kind"] | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const firstRoomRef = useRef<HTMLInputElement>(null);
  const crossConfirmRef = useRef<HTMLInputElement>(null);
  const ackRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  /** A request is on the wire: nothing may be edited, closed or sent again. */
  const inFlightRef = useRef(false);
  /** A terminal outcome was reached: sending again from this dialog is never allowed. */
  const submitLockedRef = useRef(false);
  /** `onClose` has been asked for once; one close is one call. */
  const closeRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  /** The permission as of the latest render, for wording an outcome that arrives later. */
  const crossEnabledRef = useRef(crossRoomTypeEnabled);

  // The source room is never a destination (D2). Without crossRoomType only the sold RoomType is offered.
  const offeredRooms = target.candidateRooms.filter(
    (room) => room.id !== segment.physicalRoomId && (crossRoomTypeEnabled || room.roomTypeId === soldRoomTypeId)
  );
  const soldTypeRooms = offeredRooms.filter((room) => room.roomTypeId === soldRoomTypeId);
  const otherTypeRooms = offeredRooms.filter((room) => room.roomTypeId !== soldRoomTypeId);
  const selectedRoom = offeredRooms.find((room) => room.id === selectedRoomId) ?? null;

  const check = checkSplitDate(segment.startDate, segment.endDate, splitDate);
  const splitCheck = check.kind === "ok" ? check : null;
  const isPastDate = splitCheck !== null && compareSplitDateToToday(splitDate, target.localToday) === "before";
  const prefixCross = target.currentRoomTypeId !== soldRoomTypeId;
  const suffixCross = selectedRoom !== null && selectedRoom.roomTypeId !== soldRoomTypeId;
  const crossNeeded = prefixCross || suffixCross;
  const isStale = targetKey(target) !== openedForKey;

  // Nothing about the range or the Property date can be trusted: no form, no Confirm, no intent.
  const unusableMessage =
    bounds === null || sourceNights === null
      ? sourceNights === 1
        ? "This segment has only one night, so there is no date to split it at. Both parts need at least one night."
        : "This segment's date range is not valid, so it cannot be split. Nothing can be sent from here."
      : !localTodayValid
        ? "The Property's date is not valid, so this dialog cannot tell whether a split date is in the past. Nothing can be sent from here."
        : null;
  const blockedMessage = isStale
    ? "This segment changed on the server after this dialog was opened, so the choices here no longer apply. Close it and open the split-move again from the board."
    : !assignmentWriteEnabled
      ? "Splitting a room assignment needs permission to change assignments at this Property. Nothing can be sent from here."
      : prefixCross && !crossRoomTypeEnabled
        ? "A Manager must split a stay placed in a different room type than sold. Nothing can be sent from here."
        : offeredRooms.length === 0
          ? crossRoomTypeEnabled
            ? "No other Active room is available to take the later nights on this Property."
            : "No other Active room of the sold room type is available to take the later nights on this Property."
          : null;

  const terminal = result !== null && !result.allowResubmit;
  const canSubmit = unusableMessage === null && blockedMessage === null && !terminal;
  const fieldsDisabled = !canSubmit || pending;

  useEffect(() => {
    crossEnabledRef.current = crossRoomTypeEnabled;
  });

  useEffect(() => {
    mountedRef.current = true;
    const date = dateRef.current;
    (date && !date.matches(":disabled") ? date : closeButtonRef.current)?.focus();
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

  /** An edit is only possible before a request is sent and before a terminal outcome. */
  const editable = () => !inFlightRef.current && !submitLockedRef.current;
  /** A correctable outcome belongs to the previous choice; a terminal one stays. */
  const dropCorrectableResult = () => setResult((current) => (current && current.allowResubmit ? null : current));

  /** Acknowledgements and confirmations belong to one date and one destination; none is carried to another. */
  const resetAcknowledgements = () => {
    setCrossConfirmed(false);
    setPastAcknowledged(false);
  };

  const changeDate = (value: string) => {
    if (!editable()) return;
    setSplitDate(value);
    resetAcknowledgements();
    setErrors({});
    dropCorrectableResult();
  };

  const selectRoom = (roomId: string) => {
    if (!editable()) return;
    setSelectedRoomId(roomId);
    resetAcknowledgements();
    setReason("");
    setErrors({});
    dropCorrectableResult();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlightRef.current || submitLockedRef.current || !canSubmit) return;

    const nextErrors: FieldErrors = {};
    if (check.kind === "empty") nextErrors.date = "Choose the date the destination room takes over.";
    else if (check.kind === "invalid") nextErrors.date = "Enter a real date as YYYY-MM-DD.";
    else if (check.kind === "out-of-range" || check.kind === "no-interior-date") {
      nextErrors.date = bounds
        ? `The split date must be from ${bounds.min} to ${bounds.max}, so both rooms keep at least one night.`
        : "There is no date to split this segment at.";
    }
    if (!selectedRoom) nextErrors.room = "Select the room that takes the later nights.";
    if (isPastDate && !pastAcknowledged) nextErrors.ack = "Acknowledge that this changes nights that have already passed.";
    const trimmedReason = reason.trim();
    if (crossNeeded && !crossConfirmed) nextErrors.cross = "Confirm this cross-room-type placement to continue.";
    if (crossNeeded && trimmedReason === "") nextErrors.reason = "Enter a reason for this cross-room-type placement.";
    else if (trimmedReason.length > SPLIT_MOVE_REASON_MAX_LENGTH) {
      nextErrors.reason = `The reason can be at most ${SPLIT_MOVE_REASON_MAX_LENGTH} characters (now ${trimmedReason.length}).`;
    }

    if (nextErrors.date || nextErrors.room || nextErrors.cross || nextErrors.reason || nextErrors.ack) {
      setErrors(nextErrors);
      const firstInvalid = nextErrors.date
        ? dateRef.current
        : nextErrors.room
          ? firstRoomRef.current
          : nextErrors.cross
            ? crossConfirmRef.current
            : nextErrors.ack
              ? ackRef.current
              : reasonRef.current;
      firstInvalid?.focus();
      return;
    }
    if (!selectedRoom) return;

    const intent: SplitMoveIntent = {
      splitDate,
      destinationPhysicalRoomId: selectedRoom.id,
      confirmCrossRoomType: crossNeeded,
      ...(trimmedReason !== "" ? { reason: trimmedReason } : {}),
      pastDateAcknowledged: isPastDate && pastAcknowledged,
    };

    inFlightRef.current = true;
    setErrors({});
    setPending(true);
    setResult(null);
    setOutcomeKind(null);

    let outcome: SplitMoveAssignmentOutcome;
    try {
      outcome = await onSubmit(intent);
    } catch {
      // onSubmit is not expected to throw; if it does, the request may have been sent.
      outcome = { kind: "unknown", reason: "network" };
    }

    const view = describeSplitMoveOutcome(outcome, { crossRoomTypeEnabled: crossEnabledRef.current });
    // Refs first and unconditionally, so the guards are correct even if the caller unmounted this dialog.
    submitLockedRef.current = !view.allowResubmit;
    inFlightRef.current = false;
    if (!mountedRef.current) return;
    setPending(false);
    setOutcomeKind(outcome.kind);
    setResult(view);
  };

  const dateInvalidShown = errors.date !== undefined;

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
              Move from a date
            </h3>
            <p id={descriptionId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Keeps the earlier nights of this segment in its room and moves the later nights to another room from the
              date you choose. The stay dates, prices and booking are not changed.
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
              <SummaryRow label="Property" value={target.propertyName} />
              <SummaryRow label="Property date" value={target.localToday} mono />
              <SummaryRow label="Sold room type" value={target.soldRoomTypeName} />
              <SummaryRow label="Current room" value={`${target.currentRoomNumber} (${target.currentRoomTypeName})`} />
              <SummaryRow
                label="Segment [start, end)"
                value={`[${segment.startDate}, ${segment.endDate})${sourceNights !== null ? ` · ${nightsLabel(sourceNights)}` : ""}`}
                mono
              />
            </dl>

            {unusableMessage !== null && (
              <p role="alert" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-white/5 dark:text-gray-300">
                {unusableMessage}
              </p>
            )}
            {unusableMessage === null && blockedMessage !== null && (
              <p role="alert" className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
                {blockedMessage}
              </p>
            )}

            {unusableMessage === null && bounds !== null && (
              <fieldset disabled={fieldsDisabled} className="space-y-4">
                <div>
                  <label htmlFor={dateId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Destination room takes over from
                  </label>
                  <input
                    ref={dateRef}
                    id={dateId}
                    type="date"
                    value={splitDate}
                    min={bounds.min}
                    max={bounds.max}
                    onChange={(event) => changeDate(event.target.value)}
                    aria-required="true"
                    aria-invalid={dateInvalidShown || undefined}
                    aria-describedby={dateInvalidShown ? `${dateHelpId} ${dateErrorId}` : dateHelpId}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  />
                  <p id={dateHelpId} className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    From {bounds.min} to {bounds.max}: the first night in the destination room, so each room keeps at
                    least one night.
                  </p>
                  {errors.date && (
                    <p id={dateErrorId} role="alert" className="mt-1 text-xs text-error-600 dark:text-error-400">
                      {errors.date}
                    </p>
                  )}
                </div>

                <div>
                  <p id={roomLegendId} className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                    Room for the later nights
                  </p>
                  <div
                    role="radiogroup"
                    aria-labelledby={roomLegendId}
                    aria-required="true"
                    aria-invalid={errors.room !== undefined || undefined}
                    aria-describedby={errors.room ? roomErrorId : undefined}
                    className="max-h-48 space-y-1.5 overflow-y-auto pr-1"
                  >
                    {crossRoomTypeEnabled && soldTypeRooms.length > 0 && (
                      <p className="pt-0.5 text-xs font-medium text-gray-400 dark:text-gray-500">
                        {target.soldRoomTypeName} (sold room type)
                      </p>
                    )}
                    {soldTypeRooms.map((room, index) => (
                      <RoomOption
                        key={room.id}
                        room={room}
                        crossType={false}
                        name={roomGroupName}
                        checked={selectedRoomId === room.id}
                        onSelect={selectRoom}
                        inputRef={index === 0 ? firstRoomRef : undefined}
                      />
                    ))}
                    {crossRoomTypeEnabled && otherTypeRooms.length > 0 && (
                      <>
                        <p className="pt-2 text-xs font-medium text-gray-400 dark:text-gray-500">
                          Other room types — requires confirmation and a reason
                        </p>
                        {otherTypeRooms.map((room, index) => (
                          <RoomOption
                            key={room.id}
                            room={room}
                            crossType
                            name={roomGroupName}
                            checked={selectedRoomId === room.id}
                            onSelect={selectRoom}
                            inputRef={soldTypeRooms.length === 0 && index === 0 ? firstRoomRef : undefined}
                          />
                        ))}
                      </>
                    )}
                  </div>
                  {errors.room && (
                    <p id={roomErrorId} role="alert" className="mt-2 text-xs text-error-600 dark:text-error-400">
                      {errors.room}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                    These are candidate rooms, not confirmed free. Availability is checked by the server when you
                    confirm.
                  </p>
                </div>

                <section aria-label="Split preview" className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-white/5">
                  {splitCheck === null ? (
                    <p className="text-gray-500 dark:text-gray-400">Choose a split date to see how the nights divide.</p>
                  ) : (
                    <ul className="space-y-1 text-gray-700 dark:text-gray-200">
                      <li>
                        <span className="font-medium">
                          Room {target.currentRoomNumber} keeps {nightsLabel(splitCheck.prefixNights)}
                        </span>{" "}
                        <span className="font-mono text-xs">
                          [{segment.startDate}, {splitDate}) · last night {shiftIsoDate(splitDate, -1)}
                        </span>
                      </li>
                      <li>
                        <span className="font-medium">
                          {selectedRoom ? `Room ${selectedRoom.roomNumber}` : "The destination room"} takes{" "}
                          {nightsLabel(splitCheck.suffixNights)}
                        </span>{" "}
                        <span className="font-mono text-xs">
                          [{splitDate}, {segment.endDate})
                        </span>
                      </li>
                    </ul>
                  )}
                </section>

                {crossNeeded && (
                  <div className="space-y-3 rounded-lg border border-warning-300 bg-warning-50 px-3 py-3 dark:border-warning-500/40 dark:bg-warning-500/10">
                    <div>
                      <p className="text-sm font-medium text-warning-800 dark:text-warning-300">Cross-room-type placement</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-warning-700 dark:text-warning-400">
                        {prefixCross && (
                          <li>
                            The earlier nights stay in room {target.currentRoomNumber} ({target.currentRoomTypeName}),
                            which is not the sold room type ({target.soldRoomTypeName}).
                          </li>
                        )}
                        {suffixCross && selectedRoom && (
                          <li>
                            The later nights go to room {selectedRoom.roomNumber} ({selectedRoom.roomTypeName}), which
                            is not the sold room type ({target.soldRoomTypeName}).
                          </li>
                        )}
                        <li>Splitting does not change what was sold or its price.</li>
                      </ul>
                    </div>
                    <label className="flex items-start gap-2 text-sm text-warning-800 dark:text-warning-300">
                      <input
                        ref={crossConfirmRef}
                        type="checkbox"
                        checked={crossConfirmed}
                        onChange={(event) => {
                          if (!editable()) return;
                          setCrossConfirmed(event.target.checked);
                          setErrors((current) => ({ ...current, cross: undefined }));
                          dropCorrectableResult();
                        }}
                        aria-invalid={errors.cross !== undefined || undefined}
                        aria-describedby={errors.cross ? crossConfirmErrorId : undefined}
                        className="mt-0.5 size-4 accent-warning-600"
                      />
                      <span>
                        I have deliberately chosen to keep a part of this stay in a room of a different room type than
                        sold.
                      </span>
                    </label>
                    {errors.cross && (
                      <p id={crossConfirmErrorId} role="alert" className="text-xs text-error-600 dark:text-error-400">
                        {errors.cross}
                      </p>
                    )}
                  </div>
                )}

                {isPastDate && (
                  <div className="space-y-2 rounded-lg border border-warning-300 bg-warning-50 px-3 py-3 dark:border-warning-500/40 dark:bg-warning-500/10">
                    <p className="text-sm font-medium text-warning-800 dark:text-warning-300">
                      This date is before the Property&apos;s date ({target.localToday})
                    </p>
                    <p className="text-xs text-warning-700 dark:text-warning-400">
                      Splitting here changes the room for nights that have already passed. Do this only to correct the
                      record.
                    </p>
                    <label className="flex items-start gap-2 text-sm text-warning-800 dark:text-warning-300">
                      <input
                        ref={ackRef}
                        type="checkbox"
                        checked={pastAcknowledged}
                        onChange={(event) => {
                          if (!editable()) return;
                          setPastAcknowledged(event.target.checked);
                          setErrors((current) => ({ ...current, ack: undefined }));
                          dropCorrectableResult();
                        }}
                        aria-invalid={errors.ack !== undefined || undefined}
                        aria-describedby={errors.ack ? ackErrorId : undefined}
                        className="mt-0.5 size-4 accent-warning-600"
                      />
                      <span>I understand this changes the room for nights that have already passed.</span>
                    </label>
                    {errors.ack && (
                      <p id={ackErrorId} role="alert" className="text-xs text-error-600 dark:text-error-400">
                        {errors.ack}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label htmlFor={reasonId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                    {crossNeeded ? "Reason (required)" : "Reason (optional)"}
                  </label>
                  <textarea
                    ref={reasonRef}
                    id={reasonId}
                    value={reason}
                    onChange={(event) => {
                      if (!editable()) return;
                      setReason(event.target.value);
                      setErrors((current) => ({ ...current, reason: undefined }));
                      dropCorrectableResult();
                    }}
                    aria-required={crossNeeded || undefined}
                    aria-invalid={errors.reason !== undefined || undefined}
                    aria-describedby={errors.reason ? `${reasonHelpId} ${reasonErrorId}` : reasonHelpId}
                    rows={2}
                    placeholder={crossNeeded ? "Why is a part of this stay in a different room type than sold?" : "Why is this stay being split?"}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  />
                  <p id={reasonHelpId} className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    Up to {SPLIT_MOVE_REASON_MAX_LENGTH} characters.
                  </p>
                  {errors.reason && (
                    <p id={reasonErrorId} role="alert" className="mt-1 text-xs text-error-600 dark:text-error-400">
                      {errors.reason}
                    </p>
                  )}
                </div>
              </fieldset>
            )}

            {pending && (
              <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                Splitting{selectedRoom ? ` and moving the later nights to room ${selectedRoom.roomNumber}` : ""}… waiting for the
                server. This dialog stays open until the server responds.
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
                  <p className="mt-1 text-xs">{reloadStatusText(boardReloadStatus, outcomeKind, uncertainResolution)}</p>
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
                {pending ? "Splitting…" : selectedRoom ? `Split and move to room ${selectedRoom.roomNumber}` : "Split and move"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

const RoomOption: React.FC<{
  room: SplitMoveTarget["candidateRooms"][number];
  crossType: boolean;
  name: string;
  checked: boolean;
  onSelect: (roomId: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}> = ({ room, crossType, name, checked, onSelect, inputRef }) => (
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
    {crossType && (
      <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-700 dark:bg-warning-500/15 dark:text-warning-300">
        {room.roomTypeName}
      </span>
    )}
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
 * What is said about the board after a split-move outcome that asks for a re-read. The resolution is
 * only meaningful for an unconfirmed result; a known outcome never reads it. A finished re-read is not,
 * by itself, a statement about whether a lost request was saved.
 */
function reloadStatusText(
  status: BoardReloadStatus,
  kind: SplitMoveAssignmentOutcome["kind"] | null,
  resolution?: "unresolved" | "observed" | "changed"
): string {
  if (kind === "unknown") {
    if (resolution === "observed") {
      return "The schedule now shown on the server matches both parts of this split-move. That does not prove this request is the one that made it.";
    }
    if (resolution === "changed") {
      return "This segment has since changed on the server, so this request can no longer take effect. Its own result was never confirmed.";
    }
    if (status === "done") {
      return resolution === "unresolved"
        ? "The board was checked, but the split is not shown yet. The result is still unknown; the source room and the destination nights stay locked. Close this dialog and use Check again."
        : "The board was reloaded, but that alone does not show whether this request was saved.";
    }
  }
  if (status === "failed") return "The board could not be reloaded. Close this dialog and use Retry on the board.";
  if (status === "done") return "The board has been reloaded from the server.";
  if (status === "elsewhere") return "The view changed before the board was reloaded; the result has not been re-read yet.";
  return "Reloading the board from the server…";
}

export default ReservationSplitMoveDialog;
