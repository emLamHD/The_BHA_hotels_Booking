"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import ReservationBoardToolbar from "./ReservationBoardToolbar";
import ReservationTimeline from "./ReservationTimeline";
import ReservationMoveConfirmDialog from "./ReservationMoveConfirmDialog";
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
  ReservationMoveValidation,
  TimelineItem,
} from "./types";

const INITIAL_RANGE_LENGTH: ReservationBoardRangeLength = 14;

const ReservationBoard: React.FC = () => {
  const [selectedPropertyId, setSelectedPropertyId] = useState<PropertyId>(
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
  const [draggedReservationId, setDraggedReservationId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<ReservationMoveIntent | null>(null);
  const [hoverConflictMessage, setHoverConflictMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

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

  const visibleItems = timelineItems.filter((item) => {
    if (item.propertyId !== selectedPropertyId) return false;
    if (item.kind === "assigned-reservation") return filters.showAssigned;
    if (item.kind === "unassigned-reservation") return filters.showUnassigned;
    return filters.showOperationalBlocks;
  });

  const handleToggleFilter = (key: keyof ReservationBoardFilters) => {
    setFilters((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  // Conflict validation always runs against the complete local timeline
  // dataset for the reservation's property — never only the currently
  // visible/filtered items — so hidden Assigned/Operational items still
  // block an invalid move.
  const getMoveValidation = useCallback(
    (reservationId: string, targetRoomId: PhysicalRoomId): ReservationMoveValidation => {
      const reservation = timelineItems.find(
        (item): item is AssignedReservationItem =>
          item.kind === "assigned-reservation" && item.id === reservationId
      );
      if (!reservation) {
        return {
          status: "conflict",
          conflict: { targetRoomId, message: "Reservation not found." },
        };
      }
      if (reservation.roomId === targetRoomId) {
        return { status: "same-room" };
      }

      const targetRoom = MOCK_PHYSICAL_ROOMS.find((room) => room.id === targetRoomId);
      if (!targetRoom || !roomTypeIdsForProperty.has(targetRoom.roomTypeId)) {
        return {
          status: "conflict",
          conflict: { targetRoomId, message: "Target room is not in the selected property." },
        };
      }

      const blockingItem = timelineItems.find((item) => {
        if (item.id === reservation.id) return false;
        if (item.propertyId !== reservation.propertyId) return false;
        if (item.kind !== "assigned-reservation" && item.kind !== "operational-block") {
          return false;
        }
        if (item.roomId !== targetRoomId) return false;
        return isoRangesOverlap(
          reservation.startDate,
          reservation.endDate,
          item.startDate,
          item.endDate
        );
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
    (reservationId: string, targetRoomId: PhysicalRoomId): ReservationMoveIntent | null => {
      const reservation = timelineItems.find(
        (item): item is AssignedReservationItem =>
          item.kind === "assigned-reservation" && item.id === reservationId
      );
      const fromRoom = reservation
        ? MOCK_PHYSICAL_ROOMS.find((room) => room.id === reservation.roomId)
        : undefined;
      const toRoom = MOCK_PHYSICAL_ROOMS.find((room) => room.id === targetRoomId);
      if (!reservation || !fromRoom || !toRoom) return null;

      const fromRoomType = MOCK_ROOM_TYPES.find((rt) => rt.id === fromRoom.roomTypeId);
      const toRoomType = MOCK_ROOM_TYPES.find((rt) => rt.id === toRoom.roomTypeId);
      if (!fromRoomType || !toRoomType) return null;

      const source = MOCK_BOOKING_SOURCES.find((s) => s.id === reservation.sourceId);

      return {
        reservationId: reservation.id,
        propertyId: reservation.propertyId,
        guestName: reservation.guestName,
        sourceId: reservation.sourceId,
        sourceLabel: source?.label ?? reservation.sourceId,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
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
    },
    [timelineItems]
  );

  const handleProposeMove = useCallback(
    (reservationId: string, targetRoomId: PhysicalRoomId) => {
      const validation = getMoveValidation(reservationId, targetRoomId);

      if (validation.status === "same-room") {
        return;
      }

      if (validation.status === "conflict") {
        setStatusMessage(null);
        setHoverConflictMessage(validation.conflict.message);
        return;
      }

      const intent = buildMoveIntent(reservationId, targetRoomId);
      if (!intent) return;

      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setHoverConflictMessage(null);
      setStatusMessage(null);
      setPendingMove(intent);
    },
    [getMoveValidation, buildMoveIntent]
  );

  const handleDragFeedback = useCallback((message: string | null) => {
    setHoverConflictMessage(message);
  }, []);

  const handleDragStart = useCallback((reservationId: string) => {
    setDraggedReservationId(reservationId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedReservationId(null);
    setHoverConflictMessage(null);
  }, []);

  const handleConfirmMove = useCallback(() => {
    if (!pendingMove) return;
    setTimelineItems((previous) =>
      previous.map((item) =>
        item.kind === "assigned-reservation" && item.id === pendingMove.reservationId
          ? { ...item, roomId: pendingMove.toRoomId }
          : item
      )
    );
    setStatusMessage(
      `Demo move applied locally: Room ${pendingMove.fromRoomCode} → Room ${pendingMove.toRoomCode}. Not saved to backend.`
    );
    setPendingMove(null);
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  }, [pendingMove]);

  const handleCancelMove = useCallback(() => {
    setPendingMove(null);
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  }, []);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <ReservationBoardToolbar
        properties={MOCK_PROPERTIES}
        selectedPropertyId={selectedPropertyId}
        onSelectProperty={setSelectedPropertyId}
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
        className={`px-5 text-sm sm:px-6 ${
          hoverConflictMessage || statusMessage
            ? "border-b border-gray-200 py-2 dark:border-gray-800"
            : "h-0 overflow-hidden py-0"
        } ${
          hoverConflictMessage
            ? "text-error-600 dark:text-error-400"
            : "text-success-600 dark:text-success-400"
        }`}
      >
        {hoverConflictMessage ?? statusMessage ?? ""}
      </div>

      <ReservationTimeline
        range={range}
        todayIso={DEMO_TODAY_ISO}
        roomTypes={roomTypesForProperty}
        physicalRooms={physicalRoomsForProperty}
        items={visibleItems}
        bookingSources={MOCK_BOOKING_SOURCES}
        draggedReservationId={draggedReservationId}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onProposeMove={handleProposeMove}
        getMoveValidation={getMoveValidation}
        onDragFeedback={handleDragFeedback}
      />

      {pendingMove ? (
        <ReservationMoveConfirmDialog
          intent={pendingMove}
          onConfirm={handleConfirmMove}
          onCancel={handleCancelMove}
        />
      ) : null}
    </div>
  );
};

export default ReservationBoard;
