"use client";

/**
 * PMS-CAL-001.1: read-only timeline grid rendering the real
 * `ReservationBoardResponse` from the Admin API. Deliberately independent of
 * `ReservationTimeline.tsx`/`TimelineItemDetailsDialog.tsx` (which stay
 * mock-data-only, reserved for the next mutation slice — see FRONTEND
 * INTEGRATION CONTRACT item 2 of the PMS-CAL-001.1 Master Execution Prompt)
 * so this component never needs to fabricate the guest/source/payment/
 * lifecycle fields that type only knows how to represent as mock data.
 *
 * Every bar here is inert: no drag handlers, no click-to-mutate — clicking a
 * bar only opens a small read-only popover (see `onSelectStay`/`onSelectBlock`
 * wiring in `ReservationBoard.tsx`).
 */

import React from "react";
import { clipToVisibleRange, formatMonthDay, generateRangeDates, isWeekendIso, type VisibleRange } from "./dateMath";
import type {
  ReservationBoardOperationalBlock,
  ReservationBoardPhysicalRoom,
  ReservationBoardRoomType,
  ReservationBoardStay,
} from "@/lib/api/types";

type RowSpec =
  | { kind: "roomTypeHeader"; key: string; label: string }
  | { kind: "room"; key: string; room: ReservationBoardPhysicalRoom }
  | { kind: "unassigned"; key: string; roomTypeId: string };

export interface StaySelection {
  stay: ReservationBoardStay;
  roomTypeName: string;
  actualRoomTypeName?: string;
}

export interface BlockSelection {
  block: ReservationBoardOperationalBlock;
  roomNumber: string;
}

interface ReservationBoardServerTimelineProps {
  range: VisibleRange;
  todayIso: string;
  roomTypes: ReservationBoardRoomType[];
  physicalRooms: ReservationBoardPhysicalRoom[];
  stays: ReservationBoardStay[];
  operationalBlocks: ReservationBoardOperationalBlock[];
  showAssigned: boolean;
  showUnassigned: boolean;
  showOperationalBlocks: boolean;
  onSelectStay: (selection: StaySelection) => void;
  onSelectBlock: (selection: BlockSelection) => void;
}

const LABEL_COLUMN = "220px";

const ReservationBoardServerTimeline: React.FC<ReservationBoardServerTimelineProps> = ({
  range,
  todayIso,
  roomTypes,
  physicalRooms,
  stays,
  operationalBlocks,
  showAssigned,
  showUnassigned,
  showOperationalBlocks,
  onSelectStay,
  onSelectBlock,
}) => {
  const dates = React.useMemo(() => generateRangeDates(range), [range]);

  const roomTypeById = React.useMemo(
    () => new Map(roomTypes.map((roomType) => [roomType.id, roomType])),
    [roomTypes]
  );
  const roomsByType = React.useMemo(() => {
    const map = new Map<string, ReservationBoardPhysicalRoom[]>();
    for (const room of physicalRooms) {
      const list = map.get(room.roomTypeId) ?? [];
      list.push(room);
      map.set(room.roomTypeId, list);
    }
    return map;
  }, [physicalRooms]);

  const activeRoomTypeIds = new Set(physicalRooms.map((room) => room.roomTypeId));
  // A sold RoomType with zero active PhysicalRooms still needs its group
  // header + unassigned lane whenever a visible stay has uncovered nights
  // sold under it — otherwise the backend's authoritative unassignedRanges
  // for that stay would have nowhere to render and be silently dropped
  // below. Gated by showUnassigned so hiding that filter still hides these
  // rows, same as the always-active room types.
  const unassignedRoomTypeIds = showUnassigned
    ? new Set(
        stays
          .filter((stay) => stay.unassignedRanges.length > 0)
          .map((stay) => stay.soldRoomTypeId)
      )
    : new Set<string>();
  const orderedRoomTypes = roomTypes.filter(
    (roomType) => activeRoomTypeIds.has(roomType.id) || unassignedRoomTypeIds.has(roomType.id)
  );

  const rows: RowSpec[] = [];
  for (const roomType of orderedRoomTypes) {
    rows.push({ kind: "roomTypeHeader", key: `header-${roomType.id}`, label: roomType.name });
    for (const room of roomsByType.get(roomType.id) ?? []) {
      rows.push({ kind: "room", key: `room-${room.id}`, room });
    }
    if (showUnassigned) {
      rows.push({ kind: "unassigned", key: `unassigned-${roomType.id}`, roomTypeId: roomType.id });
    }
  }

  const rowIndexByRoomId = new Map<string, number>();
  const rowIndexByUnassignedRoomType = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.kind === "room") rowIndexByRoomId.set(row.room.id, index);
    if (row.kind === "unassigned") rowIndexByUnassignedRoomType.set(row.roomTypeId, index);
  });

  const gridRowCount = rows.length + 1; // +1 header row

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-max"
        style={{
          gridTemplateColumns: `${LABEL_COLUMN} repeat(${dates.length}, minmax(56px, 1fr))`,
          gridTemplateRows: `40px repeat(${rows.length}, 40px)`,
        }}
      >
        {/* Header row */}
        <div
          className="sticky left-0 z-20 flex items-center border-b border-gray-200 bg-white px-3 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400"
          style={{ gridColumn: 1, gridRow: 1 }}
        >
          Room
        </div>
        {dates.map((date, columnIndex) => (
          <div
            key={date}
            className={`flex flex-col items-center justify-center border-b border-l border-gray-100 text-[11px] dark:border-gray-800 ${
              isWeekendIso(date) ? "bg-gray-50 dark:bg-white/[0.02]" : ""
            } ${date === todayIso ? "bg-brand-50 dark:bg-brand-500/10" : ""}`}
            style={{ gridColumn: columnIndex + 2, gridRow: 1 }}
          >
            <span className="text-gray-400 dark:text-gray-500">{formatMonthDay(date)}</span>
          </div>
        ))}

        {/* Room / room-type / unassigned label column + background grid cells */}
        {rows.map((row, rowIndex) => (
          <RowLabelAndCells key={row.key} row={row} rowIndex={rowIndex} dates={dates} todayIso={todayIso} />
        ))}

        {/* Assigned bars */}
        {showAssigned &&
          stays.flatMap((stay) =>
            stay.assignments.map((assignment) => {
              const rowIndex = rowIndexByRoomId.get(assignment.physicalRoomId);
              if (rowIndex === undefined) return null;
              const clipped = clipToVisibleRange(assignment.startDate, assignment.endDate, range);
              if (!clipped) return null;
              const actualRoomType = roomTypeById.get(assignment.actualRoomTypeId);
              return (
                <button
                  key={assignment.segmentId}
                  type="button"
                  onClick={() =>
                    onSelectStay({
                      stay,
                      roomTypeName: roomTypeById.get(stay.soldRoomTypeId)?.name ?? "Unknown room type",
                      actualRoomTypeName: actualRoomType?.name,
                    })
                  }
                  className="z-10 m-1 flex items-center overflow-hidden rounded-md bg-brand-500 px-2 text-left text-xs font-medium text-white shadow-theme-xs hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/60"
                  style={{ gridColumn: `${clipped.startCol + 2} / span ${clipped.span}`, gridRow: rowIndex + 2 }}
                  title={`${stay.guestDisplayName} — ${stay.confirmationNumber}`}
                >
                  <span className="truncate">{stay.guestDisplayName}</span>
                </button>
              );
            })
          )}

        {/* Unassigned bars, in the sold RoomType's unassigned lane */}
        {showUnassigned &&
          stays.flatMap((stay) =>
            stay.unassignedRanges.map((unassignedRange, index) => {
              const rowIndex = rowIndexByUnassignedRoomType.get(stay.soldRoomTypeId);
              if (rowIndex === undefined) return null;
              const clipped = clipToVisibleRange(unassignedRange.startDate, unassignedRange.endDate, range);
              if (!clipped) return null;
              return (
                <button
                  key={`${stay.reservationUnitId}-unassigned-${index}`}
                  type="button"
                  onClick={() =>
                    onSelectStay({ stay, roomTypeName: roomTypeById.get(stay.soldRoomTypeId)?.name ?? "Unknown room type" })
                  }
                  className="z-10 m-1 flex items-center overflow-hidden rounded-md border-2 border-dashed border-purple-500 bg-purple-50 px-2 text-left text-xs font-medium text-purple-700 hover:bg-purple-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-500/60 dark:bg-purple-500/10 dark:text-purple-300"
                  style={{ gridColumn: `${clipped.startCol + 2} / span ${clipped.span}`, gridRow: rowIndex + 2 }}
                  title={`${stay.guestDisplayName} — unassigned — ${stay.confirmationNumber}`}
                >
                  <span className="truncate">{stay.guestDisplayName} (unassigned)</span>
                </button>
              );
            })
          )}

        {/* Operational blocks */}
        {showOperationalBlocks &&
          operationalBlocks.map((block) => {
            const rowIndex = rowIndexByRoomId.get(block.physicalRoomId);
            if (rowIndex === undefined) return null;
            const clipped = clipToVisibleRange(block.startDate, block.endDate, range);
            if (!clipped) return null;
            const room = physicalRooms.find((candidate) => candidate.id === block.physicalRoomId);
            return (
              <button
                key={block.segmentId}
                type="button"
                onClick={() => onSelectBlock({ block, roomNumber: room?.roomNumber ?? "" })}
                className="z-10 m-1 flex items-center overflow-hidden rounded-md border border-amber-500 bg-[repeating-linear-gradient(45deg,#fcd34d_0,#fcd34d_2px,transparent_2px,transparent_6px)] px-2 text-left text-xs font-medium text-amber-900 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:bg-[repeating-linear-gradient(45deg,#b45309_0,#b45309_2px,transparent_2px,transparent_6px)] dark:text-amber-100"
                style={{ gridColumn: `${clipped.startCol + 2} / span ${clipped.span}`, gridRow: rowIndex + 2 }}
                title={block.reason}
              >
                <span className="truncate">{block.reason}</span>
              </button>
            );
          })}
      </div>
      <p className="sr-only" aria-live="polite">
        {gridRowCount} rows rendered for {dates.length} visible dates.
      </p>
    </div>
  );
};

const RowLabelAndCells: React.FC<{
  row: RowSpec;
  rowIndex: number;
  dates: string[];
  todayIso: string;
}> = ({ row, rowIndex, dates, todayIso }) => {
  if (row.kind === "roomTypeHeader") {
    return (
      <>
        <div
          className="sticky left-0 z-20 flex items-center border-b border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-200"
          style={{ gridColumn: 1, gridRow: rowIndex + 2 }}
        >
          {row.label}
        </div>
        {dates.map((date, columnIndex) => (
          <div
            key={date}
            className="border-b border-l border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03]"
            style={{ gridColumn: columnIndex + 2, gridRow: rowIndex + 2 }}
          />
        ))}
      </>
    );
  }

  const label = row.kind === "room" ? row.room.roomNumber : "Unassigned";
  return (
    <>
      <div
        className="sticky left-0 z-20 flex items-center border-b border-gray-100 bg-white pl-6 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
        style={{ gridColumn: 1, gridRow: rowIndex + 2 }}
      >
        {label}
      </div>
      {dates.map((date, columnIndex) => (
        <div
          key={date}
          className={`border-b border-l border-gray-100 dark:border-gray-800 ${
            date === todayIso ? "bg-brand-50 dark:bg-brand-500/10" : ""
          } ${isWeekendIso(date) ? "bg-gray-50/60 dark:bg-white/[0.015]" : ""}`}
          style={{ gridColumn: columnIndex + 2, gridRow: rowIndex + 2 }}
        />
      ))}
    </>
  );
};

export default ReservationBoardServerTimeline;
