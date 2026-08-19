"use client";

import React, { useState } from "react";
import ReservationBoardToolbar from "./ReservationBoardToolbar";
import ReservationTimeline from "./ReservationTimeline";
import { addDaysIso, buildVisibleRange, formatRangeLabel } from "./dateMath";
import {
  DEMO_TODAY_ISO,
  MOCK_BOOKING_SOURCES,
  MOCK_PHYSICAL_ROOMS,
  MOCK_PROPERTIES,
  MOCK_ROOM_TYPES,
  MOCK_TIMELINE_ITEMS,
} from "./mockData";
import type { PropertyId, ReservationBoardFilters, ReservationBoardRangeLength } from "./types";

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

  const range = buildVisibleRange(rangeStart, rangeLength);
  const rangeLabel = formatRangeLabel(range);

  const roomTypesForProperty = MOCK_ROOM_TYPES.filter(
    (roomType) => roomType.propertyId === selectedPropertyId
  );
  const roomTypeIdsForProperty = new Set(roomTypesForProperty.map((roomType) => roomType.id));
  const physicalRoomsForProperty = MOCK_PHYSICAL_ROOMS.filter((room) =>
    roomTypeIdsForProperty.has(room.roomTypeId)
  );

  const visibleItems = MOCK_TIMELINE_ITEMS.filter((item) => {
    if (item.propertyId !== selectedPropertyId) return false;
    if (item.kind === "assigned-reservation") return filters.showAssigned;
    if (item.kind === "unassigned-reservation") return filters.showUnassigned;
    return filters.showOperationalBlocks;
  });

  const handleToggleFilter = (key: keyof ReservationBoardFilters) => {
    setFilters((previous) => ({ ...previous, [key]: !previous[key] }));
  };

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
      <ReservationTimeline
        range={range}
        todayIso={DEMO_TODAY_ISO}
        roomTypes={roomTypesForProperty}
        physicalRooms={physicalRoomsForProperty}
        items={visibleItems}
        bookingSources={MOCK_BOOKING_SOURCES}
      />
    </div>
  );
};

export default ReservationBoard;
