"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowRightIcon, InfoIcon } from "@/icons";
import { formatDisplayDate } from "./dateMath";
import { MOCK_BOOKING_SOURCES, MOCK_PHYSICAL_ROOMS, MOCK_ROOM_TYPES } from "./mockData";
import type {
  PhysicalRoomId,
  ReservationMoveIntent,
  ReservationMoveTargetGroup,
  ReservationMoveValidation,
  TimelineItem,
} from "./types";

interface ReservationMoveConfirmDialogProps {
  item: TimelineItem;
  /** Pre-resolved destination from a completed drag-drop, or null for the keyboard/select-in-dialog path. */
  initialTargetRoomId: PhysicalRoomId | null;
  moveTargetGroups: ReservationMoveTargetGroup[];
  getMoveValidation: (itemId: string, targetRoomId: PhysicalRoomId) => ReservationMoveValidation;
  buildMoveIntent: (itemId: string, targetRoomId: PhysicalRoomId) => ReservationMoveIntent | null;
  onConfirm: (intent: ReservationMoveIntent) => void;
  onCancel: () => void;
}

const TITLE_ID = "reservation-move-confirm-title";
const DESCRIPTION_ID = "reservation-move-confirm-description";
const DESTINATION_SELECT_ID = "reservation-move-destination-select";

const DIALOG_TITLE: Record<TimelineItem["kind"], string> = {
  "assigned-reservation": "Confirm room move",
  "unassigned-reservation": "Confirm room assignment",
  "operational-block": "Confirm operational block move",
};

function describeItem(item: TimelineItem): { subjectLabel: string; sourceLabel: string | null } {
  if (item.kind === "operational-block") {
    return { subjectLabel: `the operational block "${item.reason}"`, sourceLabel: null };
  }
  const source = MOCK_BOOKING_SOURCES.find((candidate) => candidate.id === item.sourceId);
  return {
    subjectLabel: `${item.guestName}'s reservation`,
    sourceLabel: source?.label ?? item.sourceId,
  };
}

const ReservationMoveConfirmDialog: React.FC<ReservationMoveConfirmDialogProps> = ({
  item,
  initialTargetRoomId,
  moveTargetGroups,
  getMoveValidation,
  buildMoveIntent,
  onConfirm,
  onCancel,
}) => {
  const [selectedRoomId, setSelectedRoomId] = useState<PhysicalRoomId | null>(
    initialTargetRoomId
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const showDestinationSelect = initialTargetRoomId === null;

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  const validation = selectedRoomId ? getMoveValidation(item.id, selectedRoomId) : null;
  const intent =
    selectedRoomId && validation?.status === "valid"
      ? buildMoveIntent(item.id, selectedRoomId)
      : null;
  const canConfirm = intent !== null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
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

  const sourceRoomId = item.kind === "unassigned-reservation" ? null : item.roomId;
  const sourceRoom = sourceRoomId
    ? MOCK_PHYSICAL_ROOMS.find((room) => room.id === sourceRoomId)
    : null;
  const sourceRoomType = sourceRoom
    ? MOCK_ROOM_TYPES.find((roomType) => roomType.id === sourceRoom.roomTypeId)
    : null;
  const soldRoomType =
    item.kind !== "operational-block"
      ? MOCK_ROOM_TYPES.find((roomType) => roomType.id === item.soldRoomTypeId)
      : null;

  const { subjectLabel, sourceLabel } = describeItem(item);
  const stayDatesLabel = `${formatDisplayDate(item.startDate)} – ${formatDisplayDate(item.endDate)}`;
  const actionVerb = item.kind === "unassigned-reservation" ? "Assign" : "Move";

  return (
    <div
      className="fixed inset-0 z-999999 flex items-center justify-center bg-gray-900/70 p-4 dark:bg-gray-950/80"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={DESCRIPTION_ID}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900 sm:p-6"
      >
        <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
          {DIALOG_TITLE[item.kind]}
        </h3>
        <p id={DESCRIPTION_ID} className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {actionVerb} {subjectLabel} ({stayDatesLabel}
          {sourceLabel ? `, ${sourceLabel}` : ""}) to a{" "}
          {item.kind === "unassigned-reservation" ? "" : "different "}room?
        </p>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <span className="block text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              From
            </span>
            {sourceRoom && sourceRoomType ? (
              <>
                <span className="mt-1 block text-sm font-medium text-gray-800 dark:text-white/90">
                  Room {sourceRoom.code}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {sourceRoomType.name}
                </span>
              </>
            ) : (
              <>
                <span className="mt-1 block text-sm font-medium text-gray-800 dark:text-white/90">
                  Unassigned
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  Sold RoomType: {soldRoomType?.name ?? "—"}
                </span>
              </>
            )}
          </div>

          <ArrowRightIcon
            className="size-4 shrink-0 text-gray-400 dark:text-gray-500"
            aria-hidden="true"
          />

          <div className="rounded-lg border border-brand-300 bg-brand-50 p-3 dark:border-brand-500/40 dark:bg-brand-500/10">
            <span className="block text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">
              To
            </span>
            {intent ? (
              <>
                <span className="mt-1 block text-sm font-medium text-gray-800 dark:text-white/90">
                  Room {intent.toRoomCode}
                </span>
                <span className="block text-xs text-gray-600 dark:text-gray-300">
                  {intent.toRoomTypeName}
                </span>
              </>
            ) : (
              <span className="mt-1 block text-sm text-gray-400 dark:text-gray-500">
                Select a room
              </span>
            )}
          </div>
        </div>

        {showDestinationSelect ? (
          <div className="mt-3">
            <label
              htmlFor={DESTINATION_SELECT_ID}
              className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300"
            >
              Destination room
            </label>
            <select
              id={DESTINATION_SELECT_ID}
              value={selectedRoomId ?? ""}
              onChange={(event) => setSelectedRoomId(event.target.value || null)}
              className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              <option value="">Select a room…</option>
              {moveTargetGroups.map((group) => (
                <optgroup key={group.roomType.id} label={group.roomType.name}>
                  {group.rooms
                    .filter((room) => room.id !== sourceRoomId)
                    .map((room) => (
                      <option key={room.id} value={room.id}>
                        Room {room.code}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            {validation?.status === "conflict" ? (
              <p
                role="alert"
                className="mt-2 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-xs text-error-600 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400"
              >
                {validation.conflict.message}
              </p>
            ) : null}
            {validation?.status === "same-room" ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                That is the current room — choose a different one to continue.
              </p>
            ) : null}
          </div>
        ) : null}

        {intent && intent.operation === "assigned-move" && intent.crossesRoomType ? (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
            Room type change: {intent.fromRoomTypeName} → {intent.toRoomTypeName}
          </p>
        ) : null}

        {intent && intent.operation === "unassigned-assign" && intent.crossesRoomType ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
            <p>Sold RoomType: {intent.soldRoomTypeName}</p>
            <p>Assigned PhysicalRoom type: {intent.toRoomTypeName}</p>
          </div>
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
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              if (intent) onConfirm(intent);
            }}
            className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-400"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReservationMoveConfirmDialog;
