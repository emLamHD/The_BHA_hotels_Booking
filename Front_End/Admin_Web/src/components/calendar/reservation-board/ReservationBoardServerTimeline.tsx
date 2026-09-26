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
 * No bar here mutates anything by itself. Assigned bars and operational
 * blocks open a small read-only popover
 * (`onSelectStay`/`onSelectBlock`). PMS-CAL-001.2-CP03A: an unassigned bar
 * reports the exact server-returned `UnassignedRange` it was drawn from
 * (`onSelectUnassignedRange`), which `ReservationBoard.tsx` turns into the
 * room-assignment dialog — the rendered, clipped grid columns are never used
 * as request dates.
 *
 * PMS-CAL-001.4-CP01: when the board passes the three `…AssignedSegment…`
 * drag callbacks, an assigned bar can also be dragged onto another room's row.
 * A drop reports only **which room** it landed on — read from the nearest
 * element carrying `data-drop-room-id` (a room row's label, its cells, or a bar
 * drawn in it) — never the column under the pointer, so dragging sideways can
 * never become a date change. The board decides whether that room is allowed
 * and opens the existing Move room dialog for review; nothing here sends a
 * request. Header and Unassigned rows carry no room and are never targets.
 * Clicking a bar still opens its details, whose Move room action remains the
 * keyboard/touch way to do the same thing.
 */

import React from "react";
import { clipToVisibleRange, formatMonthDay, generateRangeDates, isWeekendIso, type VisibleRange } from "./dateMath";
import type {
  ReservationBoardAssignment,
  ReservationBoardOperationalBlock,
  ReservationBoardPhysicalRoom,
  ReservationBoardRoomType,
  ReservationBoardStay,
  ReservationBoardUnassignedRange,
} from "@/lib/api/types";

type RowSpec =
  | { kind: "roomTypeHeader"; key: string; label: string }
  | { kind: "room"; key: string; room: ReservationBoardPhysicalRoom }
  | { kind: "unassigned"; key: string; roomTypeId: string; lane: number; label: string };

/**
 * One visible (already clipped) unassigned range, plus the lane it was packed
 * into. `startCol`/`endCol` are the half-open visible column interval
 * `[startCol, endCol)` the bar occupies.
 */
interface UnassignedBar {
  key: string;
  stay: ReservationBoardStay;
  roomTypeId: string;
  rangeIndex: number;
  startCol: number;
  endCol: number;
  span: number;
  lane: number;
}

const unassignedLaneKey = (roomTypeId: string, lane: number) => `${roomTypeId}#${lane}`;

/** Locale-independent string ordering, so lane allocation can never vary by environment. */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic ordering for lane packing: earliest visible start first, then
 * the shorter interval, then authoritative identity — never the order the
 * backend happened to return the stays in.
 */
function compareUnassignedBars(a: UnassignedBar, b: UnassignedBar): number {
  if (a.startCol !== b.startCol) return a.startCol - b.startCol;
  if (a.endCol !== b.endCol) return a.endCol - b.endCol;
  const byConfirmation = compareOrdinal(a.stay.confirmationNumber, b.stay.confirmationNumber);
  if (byConfirmation !== 0) return byConfirmation;
  const byUnit = compareOrdinal(a.stay.reservationUnitId, b.stay.reservationUnitId);
  if (byUnit !== 0) return byUnit;
  return a.rangeIndex - b.rangeIndex;
}

/**
 * PMS-CAL-001.1 correction C4: unassigned demand is not mutually exclusive —
 * two committed Units of the same sold RoomType can legitimately want a room
 * on the same night. Every bar used to land on that RoomType's single
 * unassigned row, so overlapping bars painted over each other and the covered
 * stay became invisible and unclickable. This packs them into as few lanes as
 * possible: each interval takes the lowest-numbered lane whose previous
 * interval already ended, and a new lane is created only when every existing
 * lane still overlaps. Intervals are half-open, so `[a, b)` and `[b, c)` share
 * a lane while genuinely overlapping ranges never do. Each sold RoomType is
 * packed independently.
 */
function packUnassignedLanes(bars: UnassignedBar[]): UnassignedBar[] {
  const laneEndsByRoomType = new Map<string, number[]>();
  return [...bars].sort(compareUnassignedBars).map((bar) => {
    let laneEnds = laneEndsByRoomType.get(bar.roomTypeId);
    if (laneEnds === undefined) {
      laneEnds = [];
      laneEndsByRoomType.set(bar.roomTypeId, laneEnds);
    }
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= bar.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bar.endCol);
    } else {
      laneEnds[lane] = bar.endCol;
    }
    return { ...bar, lane };
  });
}

export interface StaySelection {
  stay: ReservationBoardStay;
  roomTypeName: string;
  actualRoomTypeName?: string;
  /**
   * PMS-CAL-001.2-CP04C.2: the exact, authoritative assignment segment behind
   * the clicked bar — set only for an assigned bar (a stay can have more than
   * one assignment, and this identifies which one was clicked, not just the
   * ReservationUnit). Absent for any other selection source.
   */
  segment?: ReservationBoardAssignment;
}

/**
 * PMS-CAL-001.2-CP04C.2: the authoritative (server-returned, un-clipped)
 * assignment segment behind one clicked assigned bar, paired with its own
 * stay. `moveTarget.ts` consumes this to build the read-only data a future
 * move dialog would act on — never the rendered, window-clipped bar.
 */
export interface AssignedSegmentSelection {
  stay: ReservationBoardStay;
  segment: ReservationBoardAssignment;
}

/** The authoritative (server-returned, un-reconstructed) range behind one clicked unassigned bar. */
export interface UnassignedRangeSelection {
  stay: ReservationBoardStay;
  unassignedRange: ReservationBoardUnassignedRange;
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
  onSelectUnassignedRange: (selection: UnassignedRangeSelection) => void;
  onSelectBlock: (selection: BlockSelection) => void;
  /**
   * PMS-CAL-001.2-CP03A-C1: true while the rendered stays are known to be
   * stale — a write for this exact board has not yet been reconciled by an
   * authoritative read. Unassigned bars then stay visible and focusable but
   * are `aria-disabled` and cannot open assignment.
   */
  unassignedActionsBlocked?: boolean;
  /**
   * PMS-CAL-001.2-CP03A-C2: true for an unassigned range an earlier create
   * with a lost response may already have covered. Such a range stays
   * non-actionable even on a board that is otherwise current.
   */
  isUnassignedRangeUnconfirmed?: (reservationUnitId: string, range: ReservationBoardUnassignedRange) => boolean;
  /**
   * PMS-CAL-001.4-CP01: drag-to-move is offered only when all three are given.
   * Each returns `null` when allowed, or a short operator-facing reason why not.
   * `onAssignedSegmentDragStart` also receives the dragged bar so the board can
   * return focus to it later.
   */
  onAssignedSegmentDragStart?: (selection: AssignedSegmentSelection, bar: HTMLElement) => string | null;
  /** `physicalRoomId` is `null` when the pointer is over a row that is not a room. */
  getAssignedSegmentDropRefusal?: (selection: AssignedSegmentSelection, physicalRoomId: string | null) => string | null;
  onAssignedSegmentDrop?: (selection: AssignedSegmentSelection, physicalRoomId: string | null) => string | null;
}

/** The room a drag event is over: its own or its nearest ancestor's `data-drop-room-id`, else `null`. */
function dropRoomIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-drop-room-id]")?.dataset.dropRoomId ?? null;
}

const LABEL_COLUMN = "220px";

const DRAGGING_MESSAGE = "Drop on another room's row to review a move. The stay dates will not change.";

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
  onSelectUnassignedRange,
  onSelectBlock,
  unassignedActionsBlocked = false,
  isUnassignedRangeUnconfirmed,
  onAssignedSegmentDragStart,
  getAssignedSegmentDropRefusal,
  onAssignedSegmentDrop,
}) => {
  const dragEnabled = !!(onAssignedSegmentDragStart && getAssignedSegmentDropRefusal && onAssignedSegmentDrop);
  /** The segment being dragged; `null` when no drag of ours is in progress. */
  const draggedRef = React.useRef<AssignedSegmentSelection | null>(null);
  const [dropHover, setDropHover] = React.useState<{ roomId: string; allowed: boolean } | null>(null);
  const [dragFeedback, setDragFeedback] = React.useState<string | null>(null);
  /**
   * PMS-CAL-001.4-CP01-C1: the refusal for the target the pointer was last over.
   * A browser dispatches no `drop` after a refused `dragover` — it goes straight
   * to `dragend` — so this is the only place that reason survives the release.
   */
  const lastRefusalRef = React.useRef<string | null>(null);
  const blockedNoteId = React.useId();
  const unconfirmedNoteId = React.useId();
  let anyUnconfirmedBar = false;
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

  // Pack the visible unassigned ranges into lanes first: how many lanes each
  // sold RoomType needs is what decides its rows below. Only clipped, actually
  // visible ranges take part, so data scrolled out of the window never adds an
  // empty lane.
  const unassignedBars = showUnassigned
    ? packUnassignedLanes(
        stays.flatMap((stay) =>
          stay.unassignedRanges.flatMap((unassignedRange, rangeIndex) => {
            const clipped = clipToVisibleRange(unassignedRange.startDate, unassignedRange.endDate, range);
            if (!clipped) return [];
            return [
              {
                key: `${stay.reservationUnitId}-unassigned-${rangeIndex}`,
                stay,
                roomTypeId: stay.soldRoomTypeId,
                rangeIndex,
                startCol: clipped.startCol,
                endCol: clipped.startCol + clipped.span,
                span: clipped.span,
                lane: 0,
              },
            ];
          })
        )
      )
    : [];

  const laneCountByRoomType = new Map<string, number>();
  for (const bar of unassignedBars) {
    laneCountByRoomType.set(
      bar.roomTypeId,
      Math.max(laneCountByRoomType.get(bar.roomTypeId) ?? 0, bar.lane + 1)
    );
  }

  // A sold RoomType with zero active PhysicalRooms still needs its group
  // header + unassigned lane(s) whenever a visible stay has uncovered nights
  // sold under it (correction C2) — otherwise the backend's authoritative
  // unassignedRanges for that stay would have nowhere to render and be
  // silently dropped below. Gated by showUnassigned so hiding that filter
  // still hides these rows, same as the always-active room types.
  const orderedRoomTypes = roomTypes.filter(
    (roomType) => activeRoomTypeIds.has(roomType.id) || (laneCountByRoomType.get(roomType.id) ?? 0) > 0
  );

  const rows: RowSpec[] = [];
  for (const roomType of orderedRoomTypes) {
    rows.push({ kind: "roomTypeHeader", key: `header-${roomType.id}`, label: roomType.name });
    for (const room of roomsByType.get(roomType.id) ?? []) {
      rows.push({ kind: "room", key: `room-${room.id}`, room });
    }
    if (showUnassigned) {
      // A RoomType with active rooms always keeps one unassigned lane even when
      // empty; one without active rooms only appears here because it has bars.
      const laneCount = Math.max(
        activeRoomTypeIds.has(roomType.id) ? 1 : 0,
        laneCountByRoomType.get(roomType.id) ?? 0
      );
      for (let lane = 0; lane < laneCount; lane += 1) {
        rows.push({
          kind: "unassigned",
          key: `unassigned-${roomType.id}-${lane}`,
          roomTypeId: roomType.id,
          lane,
          label: lane === 0 ? "Unassigned" : `Unassigned ${lane + 1}`,
        });
      }
    }
  }

  const rowIndexByRoomId = new Map<string, number>();
  const rowIndexByUnassignedLane = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.kind === "room") rowIndexByRoomId.set(row.room.id, index);
    if (row.kind === "unassigned") {
      rowIndexByUnassignedLane.set(unassignedLaneKey(row.roomTypeId, row.lane), index);
    }
  });

  const gridRowCount = rows.length + 1; // +1 header row

  const roomNumberById = new Map(physicalRooms.map((room) => [room.id, room.roomNumber]));

  const endDrag = () => {
    draggedRef.current = null;
    lastRefusalRef.current = null;
    setDropHover(null);
  };

  /**
   * PMS-CAL-001.5-CP01: the same decision for `dragenter` and `dragover`. In the
   * HTML drag-and-drop model an element becomes the drop target by cancelling
   * `dragenter`; Chrome otherwise accepts the drop only after it has processed a
   * later `dragover` reply, so a quick release right after entering an allowed
   * row was silently lost (verified live in Chrome 153: 1 drop in 5 quick drags
   * with `dragover` alone, 5 in 5 once `dragenter` is cancelled too).
   */
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const dragged = draggedRef.current;
    if (!dragged || !getAssignedSegmentDropRefusal) return;
    const roomId = dropRoomIdOf(event.target);
    const refusal = getAssignedSegmentDropRefusal(dragged, roomId);
    if (refusal === null) {
      // Only an allowed room accepts the drop; everywhere else the browser
      // shows its own "not allowed" cursor and no drop event follows.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }
    const allowed = refusal === null;
    lastRefusalRef.current = refusal;
    if (roomId === null) {
      if (dropHover !== null) setDropHover(null);
    } else if (dropHover?.roomId !== roomId || dropHover.allowed !== allowed) {
      setDropHover({ roomId, allowed });
    }
    const message = allowed ? `Release to review moving this stay to room ${roomNumberById.get(roomId!) ?? ""}.` : refusal;
    if (message !== dragFeedback) setDragFeedback(message);
  };

  /** Leaving the grid entirely forgets the last target: releasing out there refuses nothing specific. */
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedRef.current) return;
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    lastRefusalRef.current = null;
    setDropHover(null);
    setDragFeedback(DRAGGING_MESSAGE);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const dragged = draggedRef.current;
    if (!dragged || !onAssignedSegmentDrop) return;
    event.preventDefault();
    endDrag();
    // The board re-checks everything here; the preview above may already be stale.
    const refusal = onAssignedSegmentDrop(dragged, dropRoomIdOf(event.target));
    setDragFeedback(refusal === null ? null : `Nothing was moved: ${refusal}`);
  };

  return (
    <div className="overflow-x-auto">
      {dragEnabled && (
        // PMS-CAL-001.4-CP01-C1: rendered, at a fixed height, before any drag
        // starts, so a message appearing, changing or wrapping mid-drag never
        // moves the room rows (and so the drop target) under the pointer. Two
        // lines are shown; a longer message is clipped visually but stays whole
        // for assistive technology and in the tooltip.
        <p
          role="status"
          data-testid="board-drag-feedback"
          title={dragFeedback ?? undefined}
          className="h-10 overflow-hidden px-3 py-1 text-xs leading-4 text-gray-600 line-clamp-2 dark:text-gray-300"
        >
          {dragFeedback}
        </p>
      )}
      <div
        className="grid min-w-max"
        onDragEnter={dragEnabled ? handleDragOver : undefined}
        onDragOver={dragEnabled ? handleDragOver : undefined}
        onDragLeave={dragEnabled ? handleDragLeave : undefined}
        onDrop={dragEnabled ? handleDrop : undefined}
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
          <RowLabelAndCells
            key={row.key}
            row={row}
            rowIndex={rowIndex}
            dates={dates}
            todayIso={todayIso}
            dropState={
              row.kind === "room" && dropHover?.roomId === row.room.id
                ? dropHover.allowed
                  ? "allowed"
                  : "refused"
                : undefined
            }
          />
        ))}

        {/*
          PMS-CAL-001.5-CP01: every bar below is `[contain:inline-size]`. The grid
          is `min-w-max` with `minmax(56px, 1fr)` columns, so any item's
          max-content width grows all date columns equally — one long block
          reason made every column 1008px wide. With its inline size contained,
          a bar's label only fills (and truncates within) the columns it spans.
        */}
        {/* Assigned bars */}
        {showAssigned &&
          stays.flatMap((stay) =>
            stay.assignments.map((assignment) => {
              const rowIndex = rowIndexByRoomId.get(assignment.physicalRoomId);
              if (rowIndex === undefined) return null;
              const clipped = clipToVisibleRange(assignment.startDate, assignment.endDate, range);
              if (!clipped) return null;
              const actualRoomType = roomTypeById.get(assignment.actualRoomTypeId);
              const segmentSelection: AssignedSegmentSelection = { stay, segment: assignment };
              return (
                <button
                  key={assignment.segmentId}
                  type="button"
                  data-drop-room-id={assignment.physicalRoomId}
                  draggable={dragEnabled || undefined}
                  onDragStart={
                    dragEnabled
                      ? (event) => {
                          const refusal = onAssignedSegmentDragStart!(segmentSelection, event.currentTarget);
                          if (refusal !== null) {
                            event.preventDefault();
                            setDragFeedback(`This stay can't be moved right now: ${refusal}`);
                            return;
                          }
                          draggedRef.current = segmentSelection;
                          // A new drag never shows an earlier drag's refusal.
                          lastRefusalRef.current = null;
                          if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = "move";
                            // Some browsers only start a drag once data is set.
                            event.dataTransfer.setData("text/plain", assignment.segmentId);
                          }
                          setDragFeedback(DRAGGING_MESSAGE);
                        }
                      : undefined
                  }
                  onDragEnd={
                    dragEnabled
                      ? () => {
                          // Still set only when no drop of ours happened: the
                          // drag was cancelled or released somewhere refused.
                          if (draggedRef.current === null) return;
                          const refusal = lastRefusalRef.current;
                          endDrag();
                          setDragFeedback(refusal === null ? "Nothing was moved." : `Nothing was moved: ${refusal}`);
                        }
                      : undefined
                  }
                  onClick={() =>
                    onSelectStay({
                      stay,
                      roomTypeName: roomTypeById.get(stay.soldRoomTypeId)?.name ?? "Unknown room type",
                      actualRoomTypeName: actualRoomType?.name,
                      segment: assignment,
                    })
                  }
                  className="z-10 m-1 flex items-center overflow-hidden rounded-md bg-brand-500 px-2 [contain:inline-size] text-left text-xs font-medium text-white shadow-theme-xs hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/60"
                  style={{ gridColumn: `${clipped.startCol + 2} / span ${clipped.span}`, gridRow: rowIndex + 2 }}
                  title={`${stay.guestDisplayName} — ${stay.confirmationNumber}`}
                >
                  <span className="truncate">{stay.guestDisplayName}</span>
                </button>
              );
            })
          )}

        {/* Unassigned bars, each in its packed lane under the sold RoomType */}
        {showUnassigned &&
          unassignedBars.map((bar) => {
            const rowIndex = rowIndexByUnassignedLane.get(unassignedLaneKey(bar.roomTypeId, bar.lane));
            if (rowIndex === undefined) return null;
            const unassignedRange = bar.stay.unassignedRanges[bar.rangeIndex];
            const unconfirmed =
              isUnassignedRangeUnconfirmed?.(bar.stay.reservationUnitId, unassignedRange) ?? false;
            if (unconfirmed) anyUnconfirmedBar = true;
            const blocked = unassignedActionsBlocked || unconfirmed;
            return (
              <button
                key={bar.key}
                type="button"
                onClick={() => {
                  if (blocked) return;
                  onSelectUnassignedRange({ stay: bar.stay, unassignedRange });
                }}
                aria-disabled={blocked || undefined}
                aria-describedby={
                  unassignedActionsBlocked ? blockedNoteId : unconfirmed ? unconfirmedNoteId : undefined
                }
                aria-label={`Assign room: ${bar.stay.guestDisplayName}, ${bar.stay.confirmationNumber}, unassigned ${bar.stay.unassignedRanges[bar.rangeIndex].startDate} to ${bar.stay.unassignedRanges[bar.rangeIndex].endDate}`}
                className="z-10 m-1 flex items-center overflow-hidden rounded-md border-2 border-dashed border-purple-500 [contain:inline-size] bg-purple-50 px-2 text-left text-xs font-medium text-purple-700 hover:bg-purple-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-purple-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-500/60 dark:bg-purple-500/10 dark:text-purple-300"
                style={{ gridColumn: `${bar.startCol + 2} / span ${bar.span}`, gridRow: rowIndex + 2 }}
                title={`${bar.stay.guestDisplayName} — unassigned — ${bar.stay.confirmationNumber}`}
              >
                <span className="truncate">{bar.stay.guestDisplayName} (unassigned)</span>
              </button>
            );
          })}

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
                data-drop-room-id={block.physicalRoomId}
                onClick={() => onSelectBlock({ block, roomNumber: room?.roomNumber ?? "" })}
                className="z-10 m-1 flex items-center overflow-hidden rounded-md border border-amber-500 [contain:inline-size] bg-[repeating-linear-gradient(45deg,#fcd34d_0,#fcd34d_2px,transparent_2px,transparent_6px)] px-2 text-left text-xs font-medium text-amber-900 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:bg-[repeating-linear-gradient(45deg,#b45309_0,#b45309_2px,transparent_2px,transparent_6px)] dark:text-amber-100"
                style={{ gridColumn: `${clipped.startCol + 2} / span ${clipped.span}`, gridRow: rowIndex + 2 }}
                title={block.reason}
              >
                <span className="truncate">{block.reason}</span>
              </button>
            );
          })}
      </div>
      {unassignedActionsBlocked && (
        <p id={blockedNoteId} className="sr-only">
          Refreshing from the server: assignment is unavailable until the latest board has loaded.
        </p>
      )}
      {anyUnconfirmedBar && !unassignedActionsBlocked && (
        <p id={unconfirmedNoteId} className="sr-only">
          An earlier assignment request for these nights has an unconfirmed result, so they cannot be assigned
          until the server shows what happened.
        </p>
      )}
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
  /** PMS-CAL-001.4-CP01: this room row is under an in-progress drag. */
  dropState?: "allowed" | "refused";
}> = ({ row, rowIndex, dates, todayIso, dropState }) => {
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

  const label = row.kind === "room" ? row.room.roomNumber : row.label;
  // Only a room row is a drop target; header and Unassigned rows carry no room.
  const dropRoomId = row.kind === "room" ? row.room.id : undefined;
  const dropClass =
    dropState === "allowed"
      ? "bg-brand-100/70 dark:bg-brand-500/20"
      : dropState === "refused"
        ? "bg-error-50 dark:bg-error-500/10"
        : "";
  return (
    <>
      <div
        data-drop-room-id={dropRoomId}
        className={`sticky left-0 z-20 flex items-center border-b border-gray-100 bg-white pl-6 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 ${dropClass}`}
        style={{ gridColumn: 1, gridRow: rowIndex + 2 }}
      >
        {label}
      </div>
      {dates.map((date, columnIndex) => (
        <div
          key={date}
          data-drop-room-id={dropRoomId}
          className={`border-b border-l border-gray-100 dark:border-gray-800 ${
            date === todayIso ? "bg-brand-50 dark:bg-brand-500/10" : ""
          } ${isWeekendIso(date) ? "bg-gray-50/60 dark:bg-white/[0.015]" : ""} ${dropClass}`}
          style={{ gridColumn: columnIndex + 2, gridRow: rowIndex + 2 }}
        />
      ))}
    </>
  );
};

export default ReservationBoardServerTimeline;
