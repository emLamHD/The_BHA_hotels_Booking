import React, { useState } from "react";
import {
  clipToVisibleRange,
  formatDisplayDate,
  generateRangeDates,
  getWeekdayLabel,
  isWeekendIso,
  type ClippedSpan,
  type VisibleRange,
} from "./dateMath";
import type {
  AssignedReservationItem,
  BookingSource,
  IsoDate,
  OperationalBlockItem,
  PhysicalRoom,
  PhysicalRoomId,
  RoomType,
  RoomTypeId,
  TimelineItem,
  ReservationMoveValidation,
  UnassignedReservationItem,
} from "./types";

const ROOM_COLUMN_WIDTH_PX = 208;
const DATE_COLUMN_WIDTH_PX = 112;
const WIDE_BAR_THRESHOLD_PX = 3 * DATE_COLUMN_WIDTH_PX;

interface ReservationTimelineProps {
  range: VisibleRange;
  todayIso: IsoDate;
  roomTypes: RoomType[];
  physicalRooms: PhysicalRoom[];
  items: TimelineItem[];
  bookingSources: BookingSource[];
  draggedReservationId: string | null;
  onDragStart: (reservationId: string) => void;
  onDragEnd: () => void;
  onProposeMove: (reservationId: string, targetRoomId: PhysicalRoomId) => void;
  getMoveValidation: (
    reservationId: string,
    targetRoomId: PhysicalRoomId
  ) => ReservationMoveValidation;
  onDragFeedback: (message: string | null) => void;
}

function sourceLabelFor(bookingSources: BookingSource[], sourceId: string): string {
  return bookingSources.find((source) => source.id === sourceId)?.label ?? sourceId;
}

function headerCellClassName(isToday: boolean, isWeekend: boolean): string {
  const base =
    "flex h-16 shrink-0 flex-col items-center justify-center gap-1 border-b border-r border-gray-200 dark:border-gray-800";
  if (isToday) {
    return `${base} bg-brand-50 dark:bg-brand-500/10`;
  }
  if (isWeekend) {
    return `${base} bg-gray-50/70 dark:bg-white/[0.02]`;
  }
  return base;
}

function bodyCellClassName(isToday: boolean, isWeekend: boolean): string {
  const base = "h-full shrink-0 border-r border-gray-100 dark:border-gray-800/60";
  if (isToday) {
    return `${base} bg-brand-50/70 dark:bg-brand-500/[0.08]`;
  }
  if (isWeekend) {
    return `${base} bg-gray-50/50 dark:bg-white/[0.015]`;
  }
  return base;
}

function dropZoneClassName(state: "valid" | "invalid" | null): string {
  if (state === "valid") {
    return "outline outline-2 -outline-offset-2 outline-success-400 bg-success-50/60 dark:bg-success-500/10";
  }
  if (state === "invalid") {
    return "outline outline-2 -outline-offset-2 outline-error-400 bg-error-50/60 dark:bg-error-500/10";
  }
  return "";
}

interface MoveTargetGroup {
  roomType: RoomType;
  rooms: PhysicalRoom[];
}

interface TimelineBarProps {
  clip: ClippedSpan;
  title: string;
  primaryLabel: string;
  secondaryLabel: string;
  detailLabel?: string;
  variant: "assigned" | "unassigned" | "block";
  reservationId?: string;
  currentRoomId?: PhysicalRoomId;
  isDragged?: boolean;
  moveTargetGroups?: MoveTargetGroup[];
  onDragStart?: (reservationId: string) => void;
  onDragEnd?: () => void;
  onProposeMove?: (reservationId: string, targetRoomId: PhysicalRoomId) => void;
}

const TimelineBar: React.FC<TimelineBarProps> = ({
  clip,
  title,
  primaryLabel,
  secondaryLabel,
  detailLabel,
  variant,
  reservationId,
  currentRoomId,
  isDragged,
  moveTargetGroups,
  onDragStart,
  onDragEnd,
  onProposeMove,
}) => {
  const widthPx = clip.span * DATE_COLUMN_WIDTH_PX - 6;
  const showDetail = widthPx >= WIDE_BAR_THRESHOLD_PX && Boolean(detailLabel);
  const isMovable = variant === "assigned" && Boolean(reservationId && onProposeMove);

  const variantClassName =
    variant === "assigned"
      ? "border border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/50 dark:bg-brand-500/15 dark:text-brand-200"
      : variant === "unassigned"
      ? "border-2 border-dashed border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-400/60 dark:bg-purple-500/10 dark:text-purple-200"
      : "border border-dashed border-amber-500 bg-[repeating-linear-gradient(45deg,#fef3c7_0,#fef3c7_6px,#fffbeb_6px,#fffbeb_12px)] text-amber-800 dark:border-amber-400/60 dark:bg-[repeating-linear-gradient(45deg,rgba(245,158,11,0.18)_0,rgba(245,158,11,0.18)_6px,rgba(245,158,11,0.06)_6px,rgba(245,158,11,0.06)_12px)] dark:text-amber-200";

  return (
    <div
      title={title}
      aria-label={title}
      draggable={isMovable}
      onDragStart={
        isMovable
          ? (event) => {
              event.dataTransfer.setData("text/plain", reservationId as string);
              event.dataTransfer.effectAllowed = "move";
              onDragStart?.(reservationId as string);
            }
          : undefined
      }
      onDragEnd={isMovable ? () => onDragEnd?.() : undefined}
      className={`group absolute top-1.5 bottom-1.5 flex flex-col justify-center overflow-hidden rounded-md px-2 py-1 text-xs leading-tight outline-none transition-shadow ${variantClassName} ${
        clip.clippedStart ? "rounded-l-none border-l-4" : ""
      } ${clip.clippedEnd ? "rounded-r-none border-r-4" : ""} ${
        isMovable
          ? "cursor-grab hover:shadow-theme-xs hover:ring-1 hover:ring-brand-400/70 focus-within:ring-2 focus-within:ring-brand-500/50 active:cursor-grabbing"
          : ""
      } ${isDragged ? "opacity-40" : ""}`}
      style={{
        left: clip.startCol * DATE_COLUMN_WIDTH_PX + 3,
        width: Math.max(widthPx, DATE_COLUMN_WIDTH_PX - 6),
      }}
    >
      <span className="truncate font-medium">{primaryLabel}</span>
      <span className="truncate text-[10px] uppercase tracking-wide opacity-80">
        {secondaryLabel}
      </span>
      {showDetail ? (
        <span className="truncate text-[10px] opacity-70">{detailLabel}</span>
      ) : null}

      {isMovable && moveTargetGroups ? (
        <select
          aria-label={`Move ${primaryLabel}'s reservation to another room`}
          value=""
          draggable={false}
          onMouseDown={(event) => event.stopPropagation()}
          onDragStart={(event) => event.stopPropagation()}
          onChange={(event) => {
            const targetRoomId = event.target.value;
            if (targetRoomId && reservationId) {
              onProposeMove?.(reservationId, targetRoomId);
            }
          }}
          className="absolute right-1 top-1 z-10 h-5 max-w-[70px] rounded border border-brand-300 bg-white/95 px-0.5 text-[9px] leading-none text-brand-700 opacity-0 shadow-theme-xs focus:opacity-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/50 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-brand-500/50 dark:bg-gray-900/95 dark:text-brand-200"
        >
          <option value="">Move…</option>
          {moveTargetGroups.map((group) => (
            <optgroup key={group.roomType.id} label={group.roomType.name}>
              {group.rooms
                .filter((room) => room.id !== currentRoomId)
                .map((room) => (
                  <option key={room.id} value={room.id}>
                    Room {room.code}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      ) : null}
    </div>
  );
};

const ReservationTimeline: React.FC<ReservationTimelineProps> = ({
  range,
  todayIso,
  roomTypes,
  physicalRooms,
  items,
  bookingSources,
  draggedReservationId,
  onDragStart,
  onDragEnd,
  onProposeMove,
  getMoveValidation,
  onDragFeedback,
}) => {
  const [hoveredRoomId, setHoveredRoomId] = useState<PhysicalRoomId | null>(null);
  const [hoveredValidity, setHoveredValidity] = useState<"valid" | "invalid" | null>(null);

  const dates: IsoDate[] = generateRangeDates(range);

  const roomsByRoomType = new Map<RoomTypeId, PhysicalRoom[]>();
  physicalRooms.forEach((room) => {
    const bucket = roomsByRoomType.get(room.roomTypeId) ?? [];
    bucket.push(room);
    roomsByRoomType.set(room.roomTypeId, bucket);
  });

  const moveTargetGroups: MoveTargetGroup[] = roomTypes.map((roomType) => ({
    roomType,
    rooms: roomsByRoomType.get(roomType.id) ?? [],
  }));

  const itemsByRoomId = new Map<string, (AssignedReservationItem | OperationalBlockItem)[]>();
  const unassignedByRoomType = new Map<RoomTypeId, UnassignedReservationItem[]>();
  items.forEach((item) => {
    if (item.kind === "unassigned-reservation") {
      const bucket = unassignedByRoomType.get(item.roomTypeId) ?? [];
      bucket.push(item);
      unassignedByRoomType.set(item.roomTypeId, bucket);
      return;
    }
    const bucket = itemsByRoomId.get(item.roomId) ?? [];
    bucket.push(item);
    itemsByRoomId.set(item.roomId, bucket);
  });

  const dateAreaWidthPx = DATE_COLUMN_WIDTH_PX * range.length;
  const totalWidthPx = ROOM_COLUMN_WIDTH_PX + dateAreaWidthPx;

  const roomTypesWithUnassigned = roomTypes.filter(
    (roomType) => (unassignedByRoomType.get(roomType.id) ?? []).length > 0
  );

  const handleBarDragStart = (reservationId: string) => {
    onDragStart(reservationId);
  };

  const handleBarDragEnd = () => {
    setHoveredRoomId(null);
    setHoveredValidity(null);
    onDragEnd();
  };

  const handleRoomDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    roomId: PhysicalRoomId
  ) => {
    if (!draggedReservationId) return;
    event.preventDefault();

    const validation = getMoveValidation(draggedReservationId, roomId);
    if (validation.status === "same-room") {
      event.dataTransfer.dropEffect = "none";
      setHoveredRoomId(null);
      setHoveredValidity(null);
      onDragFeedback(null);
      return;
    }
    if (validation.status === "conflict") {
      event.dataTransfer.dropEffect = "none";
      setHoveredRoomId(roomId);
      setHoveredValidity("invalid");
      onDragFeedback(validation.conflict.message);
      return;
    }
    event.dataTransfer.dropEffect = "move";
    setHoveredRoomId(roomId);
    setHoveredValidity("valid");
    onDragFeedback(null);
  };

  const handleRoomDragLeave = (
    event: React.DragEvent<HTMLDivElement>,
    roomId: PhysicalRoomId
  ) => {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) return;
    if (hoveredRoomId === roomId) {
      setHoveredRoomId(null);
      setHoveredValidity(null);
      onDragFeedback(null);
    }
  };

  const handleRoomDrop = (event: React.DragEvent<HTMLDivElement>, roomId: PhysicalRoomId) => {
    event.preventDefault();
    setHoveredRoomId(null);
    setHoveredValidity(null);
    if (!draggedReservationId) return;
    onProposeMove(draggedReservationId, roomId);
  };

  return (
    <div className="rounded-b-2xl">
      <div className="max-h-[560px] overflow-auto" style={{ minWidth: "100%" }}>
        <div style={{ minWidth: totalWidthPx }}>
          <div className="sticky top-0 z-20 flex bg-gray-50 dark:bg-gray-900">
            <div className="sticky left-0 z-30 flex h-16 w-[208px] shrink-0 items-center border-b border-r border-gray-200 bg-gray-50 px-4 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
              Room / Room Type
            </div>
            {dates.map((date) => {
              const isToday = date === todayIso;
              const isWeekend = isWeekendIso(date);
              return (
                <div
                  key={date}
                  style={{ width: DATE_COLUMN_WIDTH_PX }}
                  className={headerCellClassName(isToday, isWeekend)}
                >
                  <span
                    className={`text-[11px] uppercase ${
                      isToday ? "text-brand-600 dark:text-brand-400" : "text-gray-400"
                    }`}
                  >
                    {getWeekdayLabel(date)}
                  </span>
                  <span
                    className={`text-sm font-semibold ${
                      isToday
                        ? "text-brand-600 dark:text-brand-400"
                        : "text-gray-700 dark:text-gray-200"
                    }`}
                  >
                    {formatDisplayDate(date).split(" ").slice(1).join(" ")}
                  </span>
                  {isToday ? (
                    <span
                      className="size-1 rounded-full bg-brand-500"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          {roomTypes.map((roomType) => (
            <React.Fragment key={roomType.id}>
              <div className="flex bg-gray-50 dark:bg-gray-900/60">
                <div className="sticky left-0 z-10 flex h-9 w-[208px] shrink-0 items-center border-b border-r border-gray-200 bg-gray-50 px-4 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400">
                  {roomType.name}
                </div>
                <div
                  className="h-9 border-b border-gray-200 dark:border-gray-800"
                  style={{ width: dateAreaWidthPx }}
                />
              </div>
              {(roomsByRoomType.get(roomType.id) ?? []).map((room) => {
                const roomItems = itemsByRoomId.get(room.id) ?? [];
                return (
                  <div
                    key={room.id}
                    className="flex"
                    onDragOver={(event) => handleRoomDragOver(event, room.id)}
                    onDragLeave={(event) => handleRoomDragLeave(event, room.id)}
                    onDrop={(event) => handleRoomDrop(event, room.id)}
                  >
                    <div className="sticky left-0 z-10 flex h-14 w-[208px] shrink-0 items-center border-b border-r border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                      {room.code}
                    </div>
                    <div
                      className={`relative h-14 border-b border-gray-200 dark:border-gray-800 ${dropZoneClassName(
                        hoveredRoomId === room.id ? hoveredValidity : null
                      )}`}
                      style={{ width: dateAreaWidthPx }}
                    >
                      <div className="absolute inset-0 flex">
                        {dates.map((date) => (
                          <div
                            key={date}
                            style={{ width: DATE_COLUMN_WIDTH_PX }}
                            className={bodyCellClassName(
                              date === todayIso,
                              isWeekendIso(date)
                            )}
                          />
                        ))}
                      </div>
                      {roomItems.map((item) => {
                        const clip = clipToVisibleRange(item.startDate, item.endDate, range);
                        if (!clip) return null;
                        if (item.kind === "operational-block") {
                          return (
                            <TimelineBar
                              key={item.id}
                              clip={clip}
                              variant="block"
                              primaryLabel="Block"
                              secondaryLabel={item.reason}
                              detailLabel={`${formatDisplayDate(item.startDate)} – ${formatDisplayDate(
                                item.endDate
                              )}`}
                              title={`Operational block: ${item.reason} · ${formatDisplayDate(
                                item.startDate
                              )} – ${formatDisplayDate(item.endDate)}`}
                            />
                          );
                        }
                        return (
                          <TimelineBar
                            key={item.id}
                            clip={clip}
                            variant="assigned"
                            reservationId={item.id}
                            currentRoomId={item.roomId}
                            isDragged={draggedReservationId === item.id}
                            moveTargetGroups={moveTargetGroups}
                            onDragStart={handleBarDragStart}
                            onDragEnd={handleBarDragEnd}
                            onProposeMove={onProposeMove}
                            primaryLabel={item.guestName}
                            secondaryLabel={`${sourceLabelFor(bookingSources, item.sourceId)} · Assigned`}
                            detailLabel={`${formatDisplayDate(item.startDate)} – ${formatDisplayDate(
                              item.endDate
                            )}`}
                            title={`${item.guestName} · ${sourceLabelFor(
                              bookingSources,
                              item.sourceId
                            )} · Assigned · ${formatDisplayDate(item.startDate)} – ${formatDisplayDate(
                              item.endDate
                            )}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}

          {roomTypesWithUnassigned.length > 0 ? (
            <>
              <div className="flex bg-gray-100 dark:bg-white/[0.04]">
                <div className="sticky left-0 z-10 flex h-9 w-[208px] shrink-0 items-center border-b border-r border-gray-200 bg-gray-100 px-4 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.04] dark:text-gray-400">
                  Chưa xếp phòng / Unassigned
                </div>
                <div
                  className="h-9 border-b border-gray-200 dark:border-gray-800"
                  style={{ width: dateAreaWidthPx }}
                />
              </div>
              {roomTypesWithUnassigned.map((roomType) => {
                const roomTypeItems = unassignedByRoomType.get(roomType.id) ?? [];
                return (
                  <div key={`unassigned-${roomType.id}`} className="flex">
                    <div className="sticky left-0 z-10 flex h-14 w-[208px] shrink-0 items-center border-b border-r border-gray-200 bg-white px-4 text-sm font-medium italic text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
                      {roomType.name}
                    </div>
                    <div
                      className="relative h-14 border-b border-gray-200 dark:border-gray-800"
                      style={{ width: dateAreaWidthPx }}
                    >
                      <div className="absolute inset-0 flex">
                        {dates.map((date) => (
                          <div
                            key={date}
                            style={{ width: DATE_COLUMN_WIDTH_PX }}
                            className={bodyCellClassName(
                              date === todayIso,
                              isWeekendIso(date)
                            )}
                          />
                        ))}
                      </div>
                      {roomTypeItems.map((item) => {
                        const clip = clipToVisibleRange(item.startDate, item.endDate, range);
                        if (!clip) return null;
                        return (
                          <TimelineBar
                            key={item.id}
                            clip={clip}
                            variant="unassigned"
                            primaryLabel={item.guestName}
                            secondaryLabel={`${sourceLabelFor(bookingSources, item.sourceId)} · Unassigned`}
                            detailLabel={`${formatDisplayDate(item.startDate)} – ${formatDisplayDate(
                              item.endDate
                            )}`}
                            title={`${item.guestName} · ${sourceLabelFor(
                              bookingSources,
                              item.sourceId
                            )} · Unassigned · ${formatDisplayDate(
                              item.startDate
                            )} – ${formatDisplayDate(item.endDate)}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ReservationTimeline;
