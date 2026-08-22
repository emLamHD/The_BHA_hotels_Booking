"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReservationBoardToolbar from "./ReservationBoardToolbar";
import ReservationTimeline from "./ReservationTimeline";
import ReservationMoveConfirmDialog from "./ReservationMoveConfirmDialog";
import TimelineItemDetailsDialog from "./TimelineItemDetailsDialog";
import { CloseLineIcon } from "@/icons";
import {
  addDaysIso,
  buildVisibleRange,
  computeVisibleStartFromAnchor,
  diffDaysIso,
  formatDisplayDate,
  formatRangeLabel,
  isoRangesOverlap,
} from "./dateMath";
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
  PropertyId,
  ReservationBoardFilters,
  ReservationBoardRangeLength,
  ReservationMoveIntent,
  ReservationMoveTarget,
  ReservationMoveTargetGroup,
  ReservationMoveValidation,
  TimelineItem,
} from "./types";

const INITIAL_RANGE_LENGTH: ReservationBoardRangeLength = 14;

interface ActionFeedback {
  kind: "success" | "error";
  message: string;
}

/** Builds the demo-only status banner text for a confirmed move, naming whichever of room/dates actually changed. */
function formatMoveSuccessMessage(intent: ReservationMoveIntent): string {
  const roomChanged =
    intent.operation === "unassigned-assign" ? true : intent.fromRoomId !== intent.toRoomId;
  const datesChanged =
    intent.fromStartDate !== intent.toStartDate || intent.fromEndDate !== intent.toEndDate;

  const toRoomLabel = `Room ${intent.toRoomCode}`;
  const toDatesLabel = `${formatDisplayDate(intent.toStartDate)} – ${formatDisplayDate(intent.toEndDate)}`;

  const changeLabel =
    roomChanged && datesChanged
      ? `${toRoomLabel}, ${toDatesLabel}`
      : roomChanged
      ? toRoomLabel
      : toDatesLabel;

  if (intent.operation === "unassigned-assign") {
    return `Demo assignment applied locally: ${intent.guestName} → ${changeLabel}. Not saved to backend.`;
  }
  if (intent.operation === "block-move") {
    return `Demo block move applied locally: ${changeLabel}. Not saved to backend.`;
  }
  return `Demo move applied locally: ${changeLabel}. Not saved to backend.`;
}

const ReservationBoard: React.FC = () => {
  const [selectedPropertyId, setSelectedPropertyIdState] = useState<PropertyId>(
    MOCK_PROPERTIES[0].id
  );
  const [rangeLength, setRangeLength] = useState<ReservationBoardRangeLength>(
    INITIAL_RANGE_LENGTH
  );
  // Anchor-centered range model (ADMIN-002.1-C5 §7): the visible window is
  // always centered on `anchorDate` rather than starting at it, so past
  // dates are visible immediately and Previous/Next can reach further back
  // than the demo "today". Today re-centers by resetting the anchor.
  const [anchorDate, setAnchorDate] = useState<string>(DEMO_TODAY_ISO);
  const rangeStart = computeVisibleStartFromAnchor(anchorDate, rangeLength);
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
  const [pendingInitialTarget, setPendingInitialTarget] =
    useState<ReservationMoveTarget | null>(null);
  // Stores the selected item's ID, never a copied item object, so the
  // dialog always resolves the latest `timelineItems` state on render and
  // reflects a room/date move made while it was previously open (ADMIN-002.1-C5 §6.3).
  const [selectedDetailsItemId, setSelectedDetailsItemId] = useState<string | null>(null);

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
    // Wait until both the move dialog and the details dialog are closed —
    // a details→move transition closes the former and opens the latter in
    // the same batch, and must not refocus the bar in between.
    if (pendingSourceItemId || selectedDetailsItemId) return;
    const itemId = focusReturnItemIdRef.current;
    if (!itemId) return;
    focusReturnItemIdRef.current = null;
    const target = document.querySelector<HTMLElement>(
      `[data-timeline-item-id="${CSS.escape(itemId)}"]`
    );
    target?.focus();
  }, [pendingSourceItemId, selectedDetailsItemId]);

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

  const selectedDetailsItem = selectedDetailsItemId
    ? timelineItems.find((item) => item.id === selectedDetailsItemId) ?? null
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
    setPendingInitialTarget(null);
    setDraggedItemId(null);
    setSelectedDetailsItemId(null);
  }, [
    setPersistentActionFeedback,
    setTransientDragFeedback,
    setPendingSourceItemId,
    setPendingInitialTarget,
    setDraggedItemId,
    setSelectedDetailsItemId,
  ]);

  // Conflict validation always runs against the complete local timeline
  // dataset for the item's property — never only the currently
  // visible/filtered items — so hidden Assigned/Operational items still
  // block an invalid move. Works uniformly for assigned reservations,
  // unassigned reservations (no current room, so a "no-op" can never apply —
  // any room selection is a genuine first-time assignment), and operational
  // blocks. A proposal is a no-op only when neither the room nor the dates
  // actually change from the item's current state.
  const getMoveValidation = useCallback(
    (itemId: string, target: ReservationMoveTarget): ReservationMoveValidation => {
      const item = timelineItems.find((candidate) => candidate.id === itemId);
      if (!item) {
        return {
          status: "conflict",
          conflict: { targetRoomId: target.targetRoomId, message: "Item not found." },
        };
      }

      const roomUnchanged =
        item.kind !== "unassigned-reservation" && item.roomId === target.targetRoomId;
      const datesUnchanged =
        item.startDate === target.targetStartDate && item.endDate === target.targetEndDate;
      if (roomUnchanged && datesUnchanged) {
        return { status: "no-op" };
      }

      const targetRoom = MOCK_PHYSICAL_ROOMS.find((room) => room.id === target.targetRoomId);
      if (!targetRoom || !roomTypeIdsForProperty.has(targetRoom.roomTypeId)) {
        return {
          status: "conflict",
          conflict: {
            targetRoomId: target.targetRoomId,
            message: "Target room is not in the selected property.",
          },
        };
      }

      const blockingItem = timelineItems.find((other) => {
        if (other.id === item.id) return false;
        if (other.propertyId !== item.propertyId) return false;
        if (other.kind !== "assigned-reservation" && other.kind !== "operational-block") {
          return false;
        }
        if (other.roomId !== target.targetRoomId) return false;
        return isoRangesOverlap(
          target.targetStartDate,
          target.targetEndDate,
          other.startDate,
          other.endDate
        );
      });

      if (blockingItem) {
        return {
          status: "conflict",
          conflict: {
            targetRoomId: target.targetRoomId,
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
    (itemId: string, target: ReservationMoveTarget): ReservationMoveIntent | null => {
      const item = timelineItems.find((candidate) => candidate.id === itemId);
      const toRoom = MOCK_PHYSICAL_ROOMS.find((room) => room.id === target.targetRoomId);
      if (!item || !toRoom) return null;
      const toRoomType = MOCK_ROOM_TYPES.find((roomType) => roomType.id === toRoom.roomTypeId);
      if (!toRoomType) return null;
      const durationNights = diffDaysIso(target.targetStartDate, target.targetEndDate);

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
          fromRoomId: fromRoom.id,
          fromRoomCode: fromRoom.code,
          fromRoomTypeId: fromRoomType.id,
          fromRoomTypeName: fromRoomType.name,
          fromStartDate: item.startDate,
          fromEndDate: item.endDate,
          toRoomId: toRoom.id,
          toRoomCode: toRoom.code,
          toRoomTypeId: toRoomType.id,
          toRoomTypeName: toRoomType.name,
          toStartDate: target.targetStartDate,
          toEndDate: target.targetEndDate,
          durationNights,
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
          fromRoomId: fromRoom.id,
          fromRoomCode: fromRoom.code,
          fromRoomTypeId: fromRoomType.id,
          fromRoomTypeName: fromRoomType.name,
          fromStartDate: item.startDate,
          fromEndDate: item.endDate,
          toRoomId: toRoom.id,
          toRoomCode: toRoom.code,
          toRoomTypeId: toRoomType.id,
          toRoomTypeName: toRoomType.name,
          toStartDate: target.targetStartDate,
          toEndDate: target.targetEndDate,
          durationNights,
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
        fromStartDate: item.startDate,
        fromEndDate: item.endDate,
        toRoomId: toRoom.id,
        toRoomCode: toRoom.code,
        toRoomTypeId: toRoomType.id,
        toRoomTypeName: toRoomType.name,
        toStartDate: target.targetStartDate,
        toEndDate: target.targetEndDate,
        durationNights,
        crossesRoomType: soldRoomType.id !== toRoomType.id,
      };
    },
    [timelineItems]
  );

  const openDialogFor = useCallback(
    (itemId: string, initialTarget: ReservationMoveTarget | null) => {
      focusReturnItemIdRef.current = itemId;
      setPersistentActionFeedback(null);
      setPendingSourceItemId(itemId);
      setPendingInitialTarget(initialTarget);
    },
    [setPersistentActionFeedback, setPendingSourceItemId, setPendingInitialTarget]
  );

  // Drag-and-drop drop path: destination room + dates are already known.
  const handleProposeMove = useCallback(
    (itemId: string, target: ReservationMoveTarget) => {
      const validation = getMoveValidation(itemId, target);

      if (validation.status === "no-op") {
        return;
      }

      if (validation.status === "conflict") {
        setPersistentActionFeedback({ kind: "error", message: validation.conflict.message });
        return;
      }

      openDialogFor(itemId, target);
    },
    [getMoveValidation, openDialogFor, setPersistentActionFeedback]
  );

  // Reached from the Details dialog's "Move / adjust stay" / "Move block"
  // action — closes Details and opens the move dialog in edit-selection mode
  // (room and/or start date still to be chosen). Reuses the same
  // getMoveValidation/buildMoveIntent logic as the drag-drop path rather
  // than a second move implementation (ADMIN-002.1-C5 §6.2).
  const handleRequestMove = useCallback(
    (itemId: string) => {
      setSelectedDetailsItemId(null);
      openDialogFor(itemId, null);
    },
    [openDialogFor, setSelectedDetailsItemId]
  );

  // Primary activation (click, guarded against a just-completed drag; or
  // Enter/Space) — opens the reservation/block details dialog.
  const handleOpenDetails = useCallback(
    (itemId: string) => {
      focusReturnItemIdRef.current = itemId;
      setPersistentActionFeedback(null);
      setSelectedDetailsItemId(itemId);
    },
    [setPersistentActionFeedback, setSelectedDetailsItemId]
  );

  const handleCloseDetails = useCallback(() => {
    setSelectedDetailsItemId(null);
  }, [setSelectedDetailsItemId]);

  const handleDragFeedback = useCallback(
    (message: string | null) => {
      setTransientDragFeedback(message);
    },
    [setTransientDragFeedback]
  );

  const handleDragStart = useCallback(
    (itemId: string) => {
      setDraggedItemId(itemId);
      // Beginning a new drag is a deliberate interaction allowed to clear a
      // stale persistent conflict/success message (Codex P2 correction).
      setPersistentActionFeedback(null);
    },
    [setDraggedItemId, setPersistentActionFeedback]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedItemId(null);
    setTransientDragFeedback(null);
    // Codex P2: deliberately do NOT clear persistentActionFeedback here.
    // The browser fires `dragend` right after every drop — including a
    // rejected one — and clearing the persistent message here would erase
    // the conflict reason the instant the drop completes.
  }, [setDraggedItemId, setTransientDragFeedback]);

  const handleConfirmMove = useCallback((intent: ReservationMoveIntent) => {
    setTimelineItems((previous) =>
      previous.map((item) => {
        if (
          intent.operation === "block-move" &&
          item.kind === "operational-block" &&
          item.id === intent.blockId
        ) {
          return {
            ...item,
            roomId: intent.toRoomId,
            startDate: intent.toStartDate,
            endDate: intent.toEndDate,
          };
        }
        if (
          intent.operation === "assigned-move" &&
          item.kind === "assigned-reservation" &&
          item.id === intent.reservationId
        ) {
          return {
            ...item,
            roomId: intent.toRoomId,
            startDate: intent.toStartDate,
            endDate: intent.toEndDate,
          };
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
            startDate: intent.toStartDate,
            endDate: intent.toEndDate,
            soldRoomTypeId: item.soldRoomTypeId,
            reservationCode: item.reservationCode,
            guestName: item.guestName,
            guestPhone: item.guestPhone,
            nationality: item.nationality,
            sourceId: item.sourceId,
            occupancy: item.occupancy,
            paymentDisplay: item.paymentDisplay,
            stayStatus: item.stayStatus,
            checkInTime: item.checkInTime,
            checkOutTime: item.checkOutTime,
            roomId: intent.toRoomId,
          };
          return assigned;
        }
        return item;
      })
    );

    setTransientDragFeedback(null);
    setPersistentActionFeedback({ kind: "success", message: formatMoveSuccessMessage(intent) });
    setPendingSourceItemId(null);
    setPendingInitialTarget(null);
  }, [
    setTimelineItems,
    setTransientDragFeedback,
    setPersistentActionFeedback,
    setPendingSourceItemId,
    setPendingInitialTarget,
  ]);

  const handleCancelMove = useCallback(() => {
    setPendingSourceItemId(null);
    setPendingInitialTarget(null);
  }, [setPendingSourceItemId, setPendingInitialTarget]);

  const handleDismissFeedback = useCallback(() => {
    setPersistentActionFeedback(null);
  }, [setPersistentActionFeedback]);

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
        onPrev={() => setAnchorDate((previous) => addDaysIso(previous, -rangeLength))}
        onNext={() => setAnchorDate((previous) => addDaysIso(previous, rangeLength))}
        onToday={() => setAnchorDate(DEMO_TODAY_ISO)}
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
        onActivateItem={handleOpenDetails}
        getMoveValidation={getMoveValidation}
        onDragFeedback={handleDragFeedback}
      />

      {selectedDetailsItem ? (
        <TimelineItemDetailsDialog
          item={selectedDetailsItem}
          physicalRooms={physicalRoomsForProperty}
          roomTypes={roomTypesForProperty}
          bookingSources={MOCK_BOOKING_SOURCES}
          onClose={handleCloseDetails}
          onRequestMove={handleRequestMove}
        />
      ) : null}

      {pendingItem ? (
        <ReservationMoveConfirmDialog
          item={pendingItem}
          initialTarget={pendingInitialTarget}
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
