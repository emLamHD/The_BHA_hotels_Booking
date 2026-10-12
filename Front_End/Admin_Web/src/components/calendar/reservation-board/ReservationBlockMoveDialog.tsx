"use client";

/**
 * PMS-CAL-003-CP03: the dialog for moving one operational block to another room — the same RoomBlock
 * header, reason and creator, the same nights, a different room. It is built from an authoritative
 * `BlockMoveTarget` (`blockMoveTarget.ts`, CP02) and hands a validated {@link BlockMoveIntent}
 * (`blockMoveSubmission.ts`) to `onSubmit`; the parent (`ReservationBoard.tsx`) owns the send — the
 * Property, segment id, version, header and dates it sends are its own, re-read from the live board at the
 * moment of sending — and answers with an `OperationalBlockMoveOutcome`. This dialog never calls the API.
 *
 * What it deliberately does not have: date inputs (the block keeps its exact nights), a cross-RoomType
 * confirmation, a past-date acknowledgement and any role rule. A block has no sold RoomType, so a room of
 * another type is an ordinary choice; whether that room type still has capacity is the server's decision and
 * is reported as a refusal, never guessed from this list. The rooms listed are candidates, not rooms known to
 * be free. The reason is optional, trimmed, at most 500 characters, and goes to the audit of this move only —
 * it does not replace the block's own reason, which is shown here as unchanged.
 *
 * Authority and safety, in the order they are applied:
 * - The nights shown are the segment's **own full `[startDate, endDate)`**, never the part the visible date
 *   range happens to display: moving a block moves all of its nights.
 * - One request at a time: `inFlightRef` is set synchronously before the first `await`, so a double click or
 *   a held Enter that dispatches several submit events in one render still starts exactly one request. While
 *   it is on the wire nothing can be edited and nothing can close the dialog (Escape, backdrop and both Close
 *   controls are inert): closing would suggest the request was cancelled, and the server may still commit.
 * - After a success, conflict, refusal or unconfirmed (`unknown`) result Confirm is gone for good, through
 *   edits, re-renders and board reloads. Only outcomes that prove nothing was written (`not-sent`, `400`) may
 *   send again, and only by an explicit new Confirm. A throwing `onSubmit` is `unknown`: the request may have left.
 * - A target whose identity changes under an open dialog (a different segment, version, room or range) sends
 *   nothing; the permission is a prop re-read on every render and again in the handler.
 * - Unmounting while a request is in flight sets no state and does not call `onClose`: the request belongs to
 *   the parent, and the dialog going away is not a cancellation.
 *
 * Focus moves into the dialog on open (the first room, or Close when nothing can be edited) and is kept inside
 * it with Tab/Shift+Tab, and moves to the result when one appears. Restoring focus to the opener belongs to the
 * parent: the popover that opened this dialog unmounts in the same commit, so the parent owns a stable opener.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { CloseLineIcon } from "@/icons";
import type { OperationalBlockMoveOutcome } from "@/lib/api/client";
import { describeBlockMoveOutcome, type AssignmentOutcomeView } from "./assignmentOutcome";
import { BLOCK_MOVE_REASON_MAX_LENGTH, type BlockMoveIntent } from "./blockMoveSubmission";
import type { BlockMoveRoomCandidate, BlockMoveTarget } from "./blockMoveTarget";
import type { BoardReloadStatus } from "./ReservationAssignmentDialog";

interface ReservationBlockMoveDialogProps {
  target: BlockMoveTarget;
  /** State of the board re-read triggered by this dialog's last outcome, if any. */
  boardReloadStatus: BoardReloadStatus;
  /** What the server's data says about a move whose response was lost. */
  uncertainResolution?: "unresolved" | "observed" | "changed";
  /** The caller may change operational blocks at this Property. Omitted means no: nothing can be sent. */
  blockWriteEnabled?: boolean;
  onSubmit: (intent: BlockMoveIntent) => Promise<OperationalBlockMoveOutcome>;
  onClose: () => void;
}

type FieldErrors = { room?: string; reason?: string };

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What identifies the source segment: a different value means this dialog's choices were made for another block. */
const targetKey = (target: BlockMoveTarget): string =>
  [
    target.propertyId,
    target.block.roomBlockId,
    target.block.segmentId,
    target.block.segmentVersion,
    target.block.physicalRoomId,
    target.block.startDate,
    target.block.endDate,
  ].join("|");

const nightsLabel = (count: number): string => `${count} ${count === 1 ? "night" : "nights"}`;

const ReservationBlockMoveDialog: React.FC<ReservationBlockMoveDialogProps> = ({
  target,
  boardReloadStatus,
  uncertainResolution,
  blockWriteEnabled = false,
  onSubmit,
  onClose,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const roomLegendId = useId();
  const roomGroupName = useId();
  const roomErrorId = useId();
  const reasonId = useId();
  const reasonHelpId = useId();
  const reasonErrorId = useId();

  const { block } = target;

  const [openedForKey] = useState(() => targetKey(target));
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AssignmentOutcomeView | null>(null);
  const [outcomeKind, setOutcomeKind] = useState<OperationalBlockMoveOutcome["kind"] | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRoomRef = useRef<HTMLInputElement>(null);
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

  // The source room is never a destination; the target already leaves it out, and this does not trust that.
  const offeredRooms = target.candidateRooms.filter((room) => room.id !== block.physicalRoomId);
  const sameTypeRooms = offeredRooms.filter((room) => room.sameRoomTypeAsSource);
  const otherTypeRooms = offeredRooms.filter((room) => !room.sameRoomTypeAsSource);
  const selectedRoom = offeredRooms.find((room) => room.id === selectedRoomId) ?? null;
  const isStale = targetKey(target) !== openedForKey;

  const blockedMessage = isStale
    ? "This block changed on the server after this dialog was opened, so the choices here no longer apply. Close it and open the move again from the board."
    : !blockWriteEnabled
      ? "Moving an operational block needs permission to change blocks at this Property. Nothing can be sent from here."
      : offeredRooms.length === 0
        ? "No other Active room is available on this Property to take this block."
        : null;

  const terminal = result !== null && !result.allowResubmit;
  const canSubmit = blockedMessage === null && !terminal;
  const fieldsDisabled = !canSubmit || pending;

  useEffect(() => {
    mountedRef.current = true;
    const first = firstRoomRef.current;
    (first && !first.matches(":disabled") ? first : closeButtonRef.current)?.focus();
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

  const selectRoom = (roomId: string) => {
    if (!editable()) return;
    setSelectedRoomId(roomId);
    setErrors((current) => ({ ...current, room: undefined }));
    dropCorrectableResult();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlightRef.current || submitLockedRef.current || !canSubmit) return;

    const trimmedReason = reason.trim();
    const nextErrors: FieldErrors = {};
    if (!selectedRoom) nextErrors.room = "Select the room that takes the block.";
    if (trimmedReason.length > BLOCK_MOVE_REASON_MAX_LENGTH) {
      nextErrors.reason = `The reason can be at most ${BLOCK_MOVE_REASON_MAX_LENGTH} characters (now ${trimmedReason.length}).`;
    }
    if (nextErrors.room || nextErrors.reason) {
      setErrors(nextErrors);
      (nextErrors.room ? firstRoomRef.current : reasonRef.current)?.focus();
      return;
    }
    if (!selectedRoom) return;

    const intent: BlockMoveIntent = {
      destinationPhysicalRoomId: selectedRoom.id,
      ...(trimmedReason !== "" ? { reason: trimmedReason } : {}),
    };

    inFlightRef.current = true;
    setErrors({});
    setPending(true);
    setResult(null);
    setOutcomeKind(null);

    let outcome: OperationalBlockMoveOutcome;
    try {
      outcome = await onSubmit(intent);
    } catch {
      // onSubmit is not expected to throw; if it does, the request may have been sent.
      outcome = { kind: "unknown", reason: "network" };
    }

    const view = describeBlockMoveOutcome(outcome);
    // Refs first and unconditionally, so the guards are correct even if the caller unmounted this dialog.
    submitLockedRef.current = !view.allowResubmit;
    inFlightRef.current = false;
    if (!mountedRef.current) return;
    setPending(false);
    setOutcomeKind(outcome.kind);
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
              Move operational block
            </h3>
            <p id={descriptionId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Moves the whole block shown below to another room. It keeps exactly the same nights and its reason; only
              the room changes. Nothing is changed until you confirm.
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
              <SummaryRow
                label="From room"
                value={`${target.sourceRoomNumber} (${target.sourceRoomTypeName})${
                  target.sourceRoomOperationalStatus === "Active" ? "" : ` · ${target.sourceRoomOperationalStatus}`
                }`}
              />
              <SummaryRow
                label="Nights [start, end)"
                value={`[${block.startDate}, ${block.endDate}) · ${nightsLabel(target.nights)}`}
                mono
              />
              <SummaryRow label="Block reason (unchanged)" value={block.reason} />
              {/* Shown so the operator can tie this confirmation to one exact segment version, the same pair that is sent as expectedVersion. */}
              <SummaryRow label="Segment" value={`${block.segmentId} · v${block.segmentVersion}`} mono />
            </dl>

            {blockedMessage !== null && (
              <p role="alert" className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
                {blockedMessage}
              </p>
            )}

            <fieldset disabled={fieldsDisabled} className="space-y-4">
              <div>
                <p id={roomLegendId} className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                  Move to room
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby={roomLegendId}
                  aria-required="true"
                  aria-invalid={errors.room !== undefined || undefined}
                  aria-describedby={errors.room ? roomErrorId : undefined}
                  className="max-h-48 space-y-1.5 overflow-y-auto pr-1"
                >
                  {sameTypeRooms.length > 0 && otherTypeRooms.length > 0 && (
                    <p className="pt-0.5 text-xs font-medium text-gray-400 dark:text-gray-500">
                      {target.sourceRoomTypeName} (same room type as the current room)
                    </p>
                  )}
                  {sameTypeRooms.map((room, index) => (
                    <RoomOption
                      key={room.id}
                      room={room}
                      otherType={false}
                      name={roomGroupName}
                      checked={selectedRoomId === room.id}
                      onSelect={selectRoom}
                      inputRef={index === 0 ? firstRoomRef : undefined}
                    />
                  ))}
                  {otherTypeRooms.length > 0 && (
                    <>
                      {sameTypeRooms.length > 0 && (
                        <p className="pt-2 text-xs font-medium text-gray-400 dark:text-gray-500">Other room types</p>
                      )}
                      {otherTypeRooms.map((room, index) => (
                        <RoomOption
                          key={room.id}
                          room={room}
                          otherType
                          name={roomGroupName}
                          checked={selectedRoomId === room.id}
                          onSelect={selectRoom}
                          inputRef={sameTypeRooms.length === 0 && index === 0 ? firstRoomRef : undefined}
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
                  These are candidate rooms, not confirmed free. Availability — and the room type&apos;s remaining
                  capacity, when it is not the current room&apos;s type — is checked by the server when you confirm.
                </p>
              </div>

              <div>
                <label htmlFor={reasonId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Reason for moving (optional)
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
                  aria-invalid={errors.reason !== undefined || undefined}
                  aria-describedby={errors.reason ? `${reasonHelpId} ${reasonErrorId}` : reasonHelpId}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
                <p id={reasonHelpId} className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Up to {BLOCK_MOVE_REASON_MAX_LENGTH} characters. Recorded with this move if you enter one. It does not
                  replace the block&apos;s own reason above.
                </p>
                {errors.reason && (
                  <p id={reasonErrorId} role="alert" className="mt-1 text-xs text-error-600 dark:text-error-400">
                    {errors.reason}
                  </p>
                )}
              </div>
            </fieldset>

            {pending && (
              <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                Moving the block{selectedRoom ? ` to room ${selectedRoom.roomNumber}` : ""}… waiting for the server. This
                dialog stays open until the server responds.
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
                {pending ? "Moving…" : selectedRoom ? `Move block to room ${selectedRoom.roomNumber}` : "Move block"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

const RoomOption: React.FC<{
  room: BlockMoveRoomCandidate;
  otherType: boolean;
  name: string;
  checked: boolean;
  onSelect: (roomId: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}> = ({ room, otherType, name, checked, onSelect, inputRef }) => (
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
    {otherType && (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
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
 * What is said about the board after a block-move outcome that asks for a re-read. The resolution is only
 * meaningful for an unconfirmed result; a known outcome never reads it. A finished re-read is not, by itself,
 * a statement about whether a lost request was saved.
 */
function reloadStatusText(
  status: BoardReloadStatus,
  kind: OperationalBlockMoveOutcome["kind"] | null,
  resolution?: "unresolved" | "observed" | "changed"
): string {
  if (kind === "unknown") {
    if (resolution === "observed") {
      // Carefully weaker than "it worked": the schedule matches the move, not necessarily this request.
      return "The schedule now shown on the server matches this move: the block is no longer in its original room and the same block holds these nights in the destination. That does not prove this request is the one that made it.";
    }
    if (resolution === "changed") {
      return "This block has since changed on the server, so this request can no longer take effect. Its own result was never confirmed.";
    }
    if (status === "done") {
      return resolution === "unresolved"
        ? "The board was checked and the block is still shown in its original room exactly as it was. The result is still unknown; both rooms stay locked for these nights. Close this dialog and use Check again."
        : "The board was reloaded, but that alone does not show whether this request was saved.";
    }
  }
  if (status === "failed") return "The board could not be reloaded. Close this dialog and use Retry on the board.";
  if (status === "done") return "The board has been reloaded from the server.";
  if (status === "elsewhere") return "The view changed before the board was reloaded; the result has not been re-read yet.";
  return "Reloading the board from the server…";
}

export default ReservationBlockMoveDialog;
