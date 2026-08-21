"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReservationBoardToolbar from "./ReservationBoardToolbar";
import ReservationTimeline from "./ReservationTimeline";
import ReservationMoveConfirmDialog from "./ReservationMoveConfirmDialog";
import { CloseLineIcon } from "@/icons";
import { addDaysIso, buildVisibleRange, formatRangeLabel, isoRangesOverlap } from "./dateMath";
import {
  DEMO_TODAY_ISO,
  MOCK_BOOKING_SOURCES,
  MOCK_PHYSICAL_ROOMS,
  MOCK_PROPERTIES,
  MOCK_ROOM_TYPES,
  MOCK_TIMELINE_ITEMS,
} from "./mockData";
import type {
  AssignedReservationItem,
  PhysicalRoomId,
  PropertyId,
  ReservationBoardFilters,
  ReservationBoardRangeLength,
  ReservationMoveIntent,
  ReservationMoveTargetGroup,
  ReservationMoveValidation,
  TimelineItem,
} from "./types";

const INITIAL_RANGE_LENGTH: ReservationBoardRangeLength = 14;

interface ActionFeedback {
  kind: "success" | "error";
  message: string;
}

const ReservationBoard: React.FC = () => {
  const [selectedPropertyId, setSelectedPropertyIdState] = useState<PropertyId>(
    MOCK_PROPERTIES[0].id
  );
  const [rangeLength, setRangeLength] = useState<ReservationBoardRangeLength>(
    INITIAL_RANGE_LENGTH
  );
  const [rangeStart, setRangeStart] = useState(DEMO_TODAY_ISO);
  const [filters, setFilters] = useState<ReservationBoardFilters>({
    showAssigned: true,
    showUnassigned: true,
    showOperationalBlocks: true,
  });

  // Runtime, demo-only assignment state. Initialized from the deterministic
  // mock dataset without mutating the exported MOCK_TIMELINE_ITEMS constant.
  // Resets to the original mock data on every page reload.
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>(() => [
    ...MOCK_TIMELINE_ITEMS,
  ]);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [pendingSourceItemId, setPendingSourceItemId] = useState<string | null>(null);
  const [pendingInitialTargetRoomId, setPendingInitialTargetRoomId] =
    useState<PhysicalRoomId | null>(null);

  // Codex P2 correction (ADMIN-002.1-C1): transient drag-hover feedback and
  // persistent post-action feedback are deliberately separate state. A
  // `dragend` that follows a completed invalid drop must clear only the
  // transient hover reason, never the persistent conflict/success message —
  // otherwise the rejection reason disappears the instant the drop finishes.
  const [transientDragFeedback, setTransientDragFeedback] = useState<string | null>(null);
  const [persistentActionFeedback, setPersistentActionFeedback] =
    useState<ActionFeedback | null>(null);

  // Tracks which timeline item's bar should reclaim focus once the dialog
  // closes. A DOM node reference is deliberately not used here: a confirmed
  // move re-parents the item's bar to a different PhysicalRoom row (or out
  // of Unassigned), so React unmounts the original node. Refocusing by
  // querying `data-timeline-item-id` after the state update commits always
  // finds the bar's current location, whether or not it moved.
  const focusReturnItemIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (pendingSourceItemId) return;
    const itemId = focusReturnItemIdRef.current;
    if (!itemId) return;
    focusReturnItemIdRef.current = null;
    const target = document.querySelector<HTMLElement>(
      `[data-timeline-item-id="${CSS.escape(itemId)}"]`
    );
    target?.focus();
  }, [pendingSourceItemId]);

  const range = buildVisibleRange(rangeStart, rangeLength);
  const rangeLabel = formatRangeLabel(range);

  const roomTypesForProperty = useMemo(
    () => MOCK_ROOM_TYPES.filter((roomType) => roomType.propertyId === selectedPropertyId),
    [selectedPropertyId]
  );
  const roomTypeIdsForProperty = useMemo(
    () => new Set(roomTypesForProperty.map((roomType) => roomType.id)),
    [roomTypesForProperty]
  );
  const physicalRoomsForProperty = useMemo(
    () => MOCK_PHYSICAL_ROOMS.filter((room) => roomTypeIdsForProperty.has(room.roomTypeId)),
    [roomTypeIdsForProperty]
  );

  const moveTargetGroups = useMemo<ReservationMoveTargetGroup[]>(() => {
    const roomsByRoomType = new Map<string, typeof physicalRoomsForProperty>();
    physicalRoomsForProperty.forEach((room) => {
      const bucket = roomsByRoomType.get(room.roomTypeId) ?? [];
      bucket.push(room);
      roomsByRoomType.set(room.roomTypeId, bucket);
    });
    return roomTypesForProperty.map((roomType) => ({
      roomType,
      rooms: roomsByRoomType.get(roomType.id) ?? [],
    }));
  }, [roomTypesForProperty, physicalRoomsForProperty]);

  const visibleItems = timelineItems.filter((item) => {
    if (item.propertyId !== selectedPropertyId) return false;
    if (item.kind === "assigned-reservation") return filters.showAssigned;
    if (item.kind === "unassigned-reservation") return filters.showUnassigned;
    return filters.showOperationalBlocks;
  });

  const pendingItem = pendingSourceItemId
    ? timelineItems.find((item) => item.id === pendingSourceItemId) ?? null
    : null;

  const handleToggleFilter = (key: keyof ReservationBoardFilters) => {
    setFilters((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  // Selecting another property is one of the deliberate later interactions
  // allowed to clear a stale conflict/success message (Codex P2 correction).
  const handleSelectProperty = useCallback((propertyId: PropertyId) => {
    setSelectedPropertyIdState(propertyId);
    setPersistentActionFeedback(null);
    setTransientDragFeedback(null);
    setPendingSourceItemId(null);
    setPendingInitialTargetRoomId(null);
    setDraggedItemId(null);
  }, []);

  // Conflict validation always runs against the complete local timeline
  // dataset for the item's property — never only the currently
  // visible/filtered items — so hidden Assigned/Operational items still
  // block an invalid move. Works uniformly for assigned reservations,
  // unassigned reservations (no current room, so "same-room" never
  // applies), and operational blocks.
  const getMoveValidation = useCallback(
    (itemId: string, targetRoomId: PhysicalRoomId): ReservationMoveValidation => {
      const item = timelineItems.find((candidate) => candidate.id === itemId);
      if (!item) {
        return {
          status: "conflict",
          conflict: { targetRoomId, message: "Item not found." },
        };
      }
      if (item.kind !== "unassigned-reservation" && item.roomId === targetRoomId) {
        return { status: "same-room" };
      }

      const targetRoom = MOCK_PHYSICAL_ROOMS.find((room) => room.id === targetRoomId);
      if (!targetRoom || !roomTypeIdsForProperty.has(targetRoom.roomTypeId)) {
        return {
          status: "conflict",
          conflict: { targetRoomId, message: "Target room is not in the selected property." },
        };
      }

      const blockingItem = timelineItems.find((other) => {
        if (other.id === item.id) return false;
        if (other.propertyId !== item.propertyId) return false;
        if (other.kind !== "assigned-reservation" && other.kind !== "operational-block") {
          return false;
        }
        if (other.roomId !== targetRoomId) return false;
        return isoRangesOverlap(item.startDate, item.endDate, other.startDate, other.endDate);
      });

      if (blockingItem) {
        return {
          status: "conflict",
          conflict: {
            targetRoomId,
            message: `Cannot move to Room ${targetRoom.code}: reservation dates overlap ${
              blockingItem.kind === "operational-block"
                ? "an operational block"
                : "an existing stay"
            }.`,
          },
        };
      }

      return { status: "valid" };
    },
    [timelineItems, roomTypeIdsForProperty]
  );

  const buildMoveIntent = useCallback(
    (itemId: string, targetRoomId: PhysicalRoomId): ReservationMoveIntent | null => {
      const item = timelineItems.find((candidate) => candidate.id === itemId);
      const toRoom = MOCK_PHYSICAL_ROOMS.find((room) => room.id === targetRoomId);
      if (!item || !toRoom) return null;
      const toRoomType = MOCK_ROOM_TYPES.find((roomType) => roomType.id === toRoom.roomTypeId);
      if (!toRoomType) return null;

      if (item.kind === "operational-block") {
        const fromRoom = MOCK_PHYSICAL_ROOMS.find((room) => room.id === item.roomId);
        const fromRoomType = fromRoom
          ? MOCK_ROOM_TYPES.find((roomType) => roomType.id === fromRoom.roomTypeId)
          : undefined;
        if (!fromRoom || !fromRoomType) return null;
        return {
          operation: "block-move",
          propertyId: item.propertyId,
          blockId: item.id,
          reason: item.reason,
          startDate: item.startDate,
          endDate: item.endDate,
          fromRoomId: fromRoom.id,
          fromRoomCode: fromRoom.code,
          fromRoomTypeId: fromRoomType.id,
          fromRoomTypeName: fromRoomType.name,
          toRoomId: toRoom.id,
          toRoomCode: toRoom.code,
          toRoomTypeId: toRoomType.id,
          toRoomTypeName: toRoomType.name,
        };
      }

      const soldRoomType = MOCK_ROOM_TYPES.find(
        (roomType) => roomType.id === item.soldRoomTypeId
      );
      if (!soldRoomType) return null;
      const source = MOCK_BOOKING_SOURCES.find((candidate) => candidate.id === item.sourceId);

      if (item.kind === "assigned-reservation") {
        const fromRoom = MOCK_PHYSICAL_ROOMS.find((room) => room.id === item.roomId);
        const fromRoomType = fromRoom
          ? MOCK_ROOM_TYPES.find((roomType) => roomType.id === fromRoom.roomTypeId)
          : undefined;
        if (!fromRoom || !fromRoomType) return null;
        return {
          operation: "assigned-move",
          propertyId: item.propertyId,
          reservationId: item.id,
          guestName: item.guestName,
          sourceId: item.sourceId,
          sourceLabel: source?.label ?? item.sourceId,
          soldRoomTypeId: soldRoomType.id,
          soldRoomTypeName: soldRoomType.name,
          startDate: item.startDate,
          endDate: item.endDate,
          fromRoomId: fromRoom.id,
          fromRoomCode: fromRoom.code,
          fromRoomTypeId: fromRoomType.id,
          fromRoomTypeName: fromRoomType.name,
          toRoomId: toRoom.id,
          toRoomCode: toRoom.code,
          toRoomTypeId: toRoomType.id,
          toRoomTypeName: toRoomType.name,
          crossesRoomType: fromRoomType.id !== toRoomType.id,
        };
      }

      return {
        operation: "unassigned-assign",
        propertyId: item.propertyId,
        reservationId: item.id,
        guestName: item.guestName,
        sourceId: item.sourceId,
        sourceLabel: source?.label ?? item.sourceId,
        soldRoomTypeId: soldRoomType.id,
        soldRoomTypeName: soldRoomType.name,
        startDate: item.startDate,
        endDate: item.endDate,
        toRoomId: toRoom.id,
        toRoomCode: toRoom.code,
        toRoomTypeId: toRoomType.id,
        toRoomTypeName: toRoomType.name,
        crossesRoomType: soldRoomType.id !== toRoomType.id,
      };
    },
    [timelineItems]
  );

  const openDialogFor = useCallback(
    (itemId: string, initialTargetRoomId: PhysicalRoomId | null) => {
      focusReturnItemIdRef.current = itemId;
      setPersistentActionFeedback(null);
      setPendingSourceItemId(itemId);
      setPendingInitialTargetRoomId(initialTargetRoomId);
    },
    []
  );

  // Drag-and-drop drop path: destination is already known.
  const handleProposeMove = useCallback(
    (itemId: string, targetRoomId: PhysicalRoomId) => {
      const validation = getMoveValidation(itemId, targetRoomId);

      if (validation.status === "same-room") {
        return;
      }

      if (validation.status === "conflict") {
        setPersistentActionFeedback({ kind: "error", message: validation.conflict.message });
        return;
      }

      openDialogFor(itemId, targetRoomId);
    },
    [getMoveValidation, openDialogFor]
  );

  // Keyboard/accessible path: Enter or Space opens the dialog in
  // destination-selection mode (no target chosen yet).
  const handleRequestMove = useCallback(
    (itemId: string) => {
      openDialogFor(itemId, null);
    },
    [openDialogFor]
  );

  const handleDragFeedback = useCallback((message: string | null) => {
    setTransientDragFeedback(message);
  }, []);

  const handleDragStart = useCallback((itemId: string) => {
    setDraggedItemId(itemId);
    // Beginning a new drag is a deliberate interaction allowed to clear a
    // stale persistent conflict/success message (Codex P2 correction).
    setPersistentActionFeedback(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedItemId(null);
    setTransientDragFeedback(null);
    // Codex P2: deliberately do NOT clear persistentActionFeedback here.
    // The browser fires `dragend` right after every drop — including a
    // rejected one — and clearing the persistent message here would erase
    // the conflict reason the instant the drop completes.
  }, []);

  const handleConfirmMove = useCallback((intent: ReservationMoveIntent) => {
    setTimelineItems((previous) =>
      previous.map((item) => {
        if (
          intent.operation === "block-move" &&
          item.kind === "operational-block" &&
          item.id === intent.blockId
        ) {
          return { ...item, roomId: intent.toRoomId };
        }
        if (
          intent.operation === "assigned-move" &&
          item.kind === "assigned-reservation" &&
          item.id === intent.reservationId
        ) {
          return { ...item, roomId: intent.toRoomId };
        }
        if (
          intent.operation === "unassigned-assign" &&
          item.kind === "unassigned-reservation" &&
          item.id === intent.reservationId
        ) {
          const assigned: AssignedReservationItem = {
            kind: "assigned-reservation",
            id: item.id,
            propertyId: item.propertyId,
            startDate: item.startDate,
            endDate: item.endDate,
            soldRoomTypeId: item.soldRoomTypeId,
            guestName: item.guestName,
            nationality: item.nationality,
            sourceId: item.sourceId,
            occupancy: item.occupancy,
            paymentDisplay: item.paymentDisplay,
            roomId: intent.toRoomId,
          };
          return assigned;
        }
        return item;
      })
    );

    const message =
      intent.operation === "assigned-move"
        ? `Demo move applied locally: Room ${intent.fromRoomCode} → Room ${intent.toRoomCode}. Not saved to backend.`
        : intent.operation === "unassigned-assign"
        ? `Demo assignment applied locally: ${intent.guestName} → Room ${intent.toRoomCode}. Not saved to backend.`
        : `Demo block move applied locally: Room ${intent.fromRoomCode} → Room ${intent.toRoomCode}. Not saved to backend.`;

    setTransientDragFeedback(null);
    setPersistentActionFeedback({ kind: "success", message });
    setPendingSourceItemId(null);
    setPendingInitialTargetRoomId(null);
  }, []);

  const handleCancelMove = useCallback(() => {
    setPendingSourceItemId(null);
    setPendingInitialTargetRoomId(null);
  }, []);

  const handleDismissFeedback = useCallback(() => {
    setPersistentActionFeedback(null);
  }, []);

  const bannerMessage = transientDragFeedback ?? persistentActionFeedback?.message ?? null;
  const bannerTone: "error" | "success" = transientDragFeedback
    ? "error"
    : persistentActionFeedback?.kind ?? "success";
  const showDismiss = !transientDragFeedback && persistentActionFeedback !== null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <ReservationBoardToolbar
        properties={MOCK_PROPERTIES}
        selectedPropertyId={selectedPropertyId}
        onSelectProperty={handleSelectProperty}
        rangeLength={rangeLength}
        onSelectRangeLength={setRangeLength}
        rangeLabel={rangeLabel}
        onPrev={() => setRangeStart((previous) => addDaysIso(previous, -rangeLength))}
        onNext={() => setRangeStart((previous) => addDaysIso(previous, rangeLength))}
        onToday={() => setRangeStart(DEMO_TODAY_ISO)}
        filters={filters}
        onToggleFilter={handleToggleFilter}
      />

      <div
        aria-live="polite"
        className={`flex items-center justify-between gap-3 px-5 text-sm sm:px-6 ${
          bannerMessage
            ? "border-b border-gray-200 py-2 dark:border-gray-800"
            : "h-0 overflow-hidden py-0"
        } ${
          bannerTone === "error"
            ? "text-error-600 dark:text-error-400"
            : "text-success-600 dark:text-success-400"
        }`}
      >
        <span>{bannerMessage ?? ""}</span>
        {showDismiss ? (
          <button
            type="button"
            onClick={handleDismissFeedback}
            aria-label="Dismiss message"
            className="shrink-0 rounded p-0.5 text-current/70 hover:text-current focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <CloseLineIcon className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <ReservationTimeline
        range={range}
        todayIso={DEMO_TODAY_ISO}
        roomTypes={roomTypesForProperty}
        physicalRooms={physicalRoomsForProperty}
        items={visibleItems}
        bookingSources={MOCK_BOOKING_SOURCES}
        draggedItemId={draggedItemId}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onProposeMove={handleProposeMove}
        onRequestMove={handleRequestMove}
        getMoveValidation={getMoveValidation}
        onDragFeedback={handleDragFeedback}
      />

      {pendingItem ? (
        <ReservationMoveConfirmDialog
          item={pendingItem}
          initialTargetRoomId={pendingInitialTargetRoomId}
          moveTargetGroups={moveTargetGroups}
          getMoveValidation={getMoveValidation}
          buildMoveIntent={buildMoveIntent}
          onConfirm={handleConfirmMove}
          onCancel={handleCancelMove}
        />
      ) : null}
    </div>
  );
};

export default ReservationBoard;
