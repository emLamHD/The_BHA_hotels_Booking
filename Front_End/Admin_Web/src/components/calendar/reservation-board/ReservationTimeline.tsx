import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  addDaysIso,
  clipToVisibleRange,
  diffDaysIso,
  formatDisplayDate,
  formatMonthDay,
  generateRangeDates,
  getWeekdayLabel,
  isWeekendIso,
  type ClippedSpan,
  type VisibleRange,
} from "./dateMath";
import ReservationHoverCard from "./ReservationHoverCard";
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
  ReservationMoveTarget,
  ReservationMoveValidation,
  UnassignedReservationItem,
} from "./types";

const ROOM_COLUMN_WIDTH_PX = 208;
const DATE_COLUMN_WIDTH_PX = 112;
const WIDE_BAR_THRESHOLD_PX = 3 * DATE_COLUMN_WIDTH_PX;

type ReservationItem = AssignedReservationItem | UnassignedReservationItem;

interface DragPreview extends ReservationMoveTarget {
  status: "valid" | "invalid";
}

interface ReservationTimelineProps {
  range: VisibleRange;
  todayIso: IsoDate;
  roomTypes: RoomType[];
  physicalRooms: PhysicalRoom[];
  items: TimelineItem[];
  bookingSources: BookingSource[];
  draggedItemId: string | null;
  onDragStart: (itemId: string) => void;
  onDragEnd: () => void;
  onProposeMove: (itemId: string, target: ReservationMoveTarget) => void;
  /** Primary activation (click or Enter/Space) — opens the reservation/block details dialog. */
  onActivateItem: (itemId: string) => void;
  getMoveValidation: (
    itemId: string,
    target: ReservationMoveTarget
  ) => ReservationMoveValidation;
  onDragFeedback: (message: string | null) => void;
}

/**
 * Resolves the 0-based date-column index (relative to `range.start`) that a
 * viewport `clientX` falls over, using the shared scroll container's own
 * bounding rect and current `scrollLeft` — every row shares one horizontal
 * scroll position, so this is accurate for any row without per-row lookups.
 */
function resolvePointerDateColumn(clientX: number, scrollContainer: HTMLElement): number {
  const rect = scrollContainer.getBoundingClientRect();
  const dateAreaLeft = rect.left + ROOM_COLUMN_WIDTH_PX - scrollContainer.scrollLeft;
  return Math.floor((clientX - dateAreaLeft) / DATE_COLUMN_WIDTH_PX);
}

function sourceLabelFor(bookingSources: BookingSource[], sourceId: string): string {
  return bookingSources.find((source) => source.id === sourceId)?.label ?? sourceId;
}

function isReservationItem(item: TimelineItem): item is ReservationItem {
  return item.kind !== "operational-block";
}

function resolveHoverContext(
  item: ReservationItem,
  physicalRooms: PhysicalRoom[],
  roomTypes: RoomType[]
): { physicalRoom: PhysicalRoom | null; roomType: RoomType | null } {
  if (item.kind === "assigned-reservation") {
    const physicalRoom = physicalRooms.find((room) => room.id === item.roomId) ?? null;
    const roomType =
      (physicalRoom && roomTypes.find((rt) => rt.id === physicalRoom.roomTypeId)) ??
      roomTypes.find((rt) => rt.id === item.soldRoomTypeId) ??
      null;
    return { physicalRoom, roomType };
  }
  return {
    physicalRoom: null,
    roomType: roomTypes.find((rt) => rt.id === item.soldRoomTypeId) ?? null,
  };
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

interface TimelineBarProps {
  item: TimelineItem;
  clip: ClippedSpan;
  primaryLabel: string;
  secondaryLabel: string;
  detailLabel?: string;
  ariaLabel: string;
  isDragged: boolean;
  onDragStart: (itemId: string, clientX: number) => void;
  onDragEnd: () => void;
  onActivate: (itemId: string) => void;
  onHoverStart: (item: ReservationItem, anchorEl: HTMLElement) => void;
  onHoverEnd: () => void;
}

const TimelineBar: React.FC<TimelineBarProps> = ({
  item,
  clip,
  primaryLabel,
  secondaryLabel,
  detailLabel,
  ariaLabel,
  isDragged,
  onDragStart,
  onDragEnd,
  onActivate,
  onHoverStart,
  onHoverEnd,
}) => {
  const widthPx = clip.span * DATE_COLUMN_WIDTH_PX - 6;
  const showDetail = widthPx >= WIDE_BAR_THRESHOLD_PX && Boolean(detailLabel);
  const variant = item.kind === "assigned-reservation" ? "assigned" : item.kind === "unassigned-reservation" ? "unassigned" : "block";
  const showsHoverCard = isReservationItem(item);

  const variantClassName =
    variant === "assigned"
      ? "border border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/50 dark:bg-brand-500/15 dark:text-brand-200"
      : variant === "unassigned"
      ? "border-2 border-dashed border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-400/60 dark:bg-purple-500/10 dark:text-purple-200"
      : "border border-dashed border-amber-500 bg-[repeating-linear-gradient(45deg,#fef3c7_0,#fef3c7_6px,#fffbeb_6px,#fffbeb_12px)] text-amber-800 dark:border-amber-400/60 dark:bg-[repeating-linear-gradient(45deg,rgba(245,158,11,0.18)_0,rgba(245,158,11,0.18)_6px,rgba(245,158,11,0.06)_6px,rgba(245,158,11,0.06)_12px)] dark:text-amber-200";

  return (
    <div
      title={variant === "block" ? ariaLabel : undefined}
      aria-label={ariaLabel}
      data-timeline-item-id={item.id}
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(item.id, event.clientX);
      }}
      onDragEnd={() => onDragEnd()}
      onClick={() => onActivate(item.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onHoverEnd();
          onActivate(item.id);
        }
      }}
      onMouseEnter={
        showsHoverCard ? (event) => onHoverStart(item, event.currentTarget) : undefined
      }
      onMouseLeave={showsHoverCard ? () => onHoverEnd() : undefined}
      onFocus={showsHoverCard ? (event) => onHoverStart(item, event.currentTarget) : undefined}
      onBlur={showsHoverCard ? () => onHoverEnd() : undefined}
      className={`group absolute top-1.5 bottom-1.5 flex cursor-grab flex-col justify-center overflow-hidden rounded-md px-2 py-1 text-xs leading-tight outline-none transition-shadow hover:shadow-theme-xs hover:ring-1 hover:ring-brand-400/70 focus-visible:ring-2 focus-visible:ring-brand-500/50 active:cursor-grabbing ${variantClassName} ${
        clip.clippedStart ? "rounded-l-none border-l-4" : ""
      } ${clip.clippedEnd ? "rounded-r-none border-r-4" : ""} ${isDragged ? "opacity-40" : ""}`}
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
  draggedItemId,
  onDragStart,
  onDragEnd,
  onProposeMove,
  onActivateItem,
  getMoveValidation,
  onDragFeedback,
}) => {
  // Days between the pointer's date column and the dragged item's real
  // startDate, captured once at dragstart so the grabbed night's relative
  // position within the bar never jumps under the pointer while dragging.
  const [dragGrabOffsetDays, setDragGrabOffsetDays] = useState<number | null>(null);
  // Set on `dragstart`, cleared shortly after `dragend` — guards against a
  // browser firing `click` right after a completed drag gesture so a drop
  // never accidentally opens the details dialog (ADMIN-002.1-C5 §6.1).
  const dragStartedRef = useRef(false);
  // Latest resolved drag candidate (room + snapped date span); used both to
  // render the preview and, per the drag-to-date spec, as the exact value
  // applied on drop rather than recomputing from the drop event.
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  // Suppressed once the drag itself ends (native dragend, or the parent
  // clearing draggedItemId for any other reason, e.g. a property switch) —
  // derived at render time rather than cleared via an effect.
  const effectiveDragPreview = draggedItemId ? dragPreview : null;
  const [hoverCardItem, setHoverCardItem] = useState<ReservationItem | null>(null);
  const [hoverCardAnchor, setHoverCardAnchor] = useState<HTMLElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const closeHoverCard = useCallback(() => {
    setHoverCardItem(null);
    setHoverCardAnchor(null);
  }, []);

  useEffect(() => {
    if (!hoverCardItem) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHoverCard();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hoverCardItem, closeHoverCard]);

  useEffect(() => {
    if (!hoverCardItem) return;
    const scrollContainer = scrollContainerRef.current;
    window.addEventListener("resize", closeHoverCard);
    window.addEventListener("scroll", closeHoverCard, { passive: true, capture: true });
    scrollContainer?.addEventListener("scroll", closeHoverCard, { passive: true });
    return () => {
      window.removeEventListener("resize", closeHoverCard);
      window.removeEventListener("scroll", closeHoverCard, true);
      scrollContainer?.removeEventListener("scroll", closeHoverCard);
    };
  }, [hoverCardItem, closeHoverCard]);

  const dates: IsoDate[] = generateRangeDates(range);

  const roomsByRoomType = new Map<RoomTypeId, PhysicalRoom[]>();
  physicalRooms.forEach((room) => {
    const bucket = roomsByRoomType.get(room.roomTypeId) ?? [];
    bucket.push(room);
    roomsByRoomType.set(room.roomTypeId, bucket);
  });

  const itemsByRoomId = new Map<string, (AssignedReservationItem | OperationalBlockItem)[]>();
  const unassignedByRoomType = new Map<RoomTypeId, UnassignedReservationItem[]>();
  items.forEach((item) => {
    if (item.kind === "unassigned-reservation") {
      const bucket = unassignedByRoomType.get(item.soldRoomTypeId) ?? [];
      bucket.push(item);
      unassignedByRoomType.set(item.soldRoomTypeId, bucket);
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

  const handleBarDragStart = (itemId: string, clientX: number) => {
    dragStartedRef.current = true;
    closeHoverCard();
    const item = items.find((candidate) => candidate.id === itemId);
    if (item && scrollContainerRef.current) {
      const pointerColumn = resolvePointerDateColumn(clientX, scrollContainerRef.current);
      const realStartColumn = diffDaysIso(range.start, item.startDate);
      setDragGrabOffsetDays(pointerColumn - realStartColumn);
    } else {
      setDragGrabOffsetDays(0);
    }
    onDragStart(itemId);
  };

  const handleBarDragEnd = () => {
    setDragPreview(null);
    setDragGrabOffsetDays(null);
    onDragEnd();
    // Deferred so a `click` firing synchronously right after `dragend` (seen
    // on some browsers for a completed drop) still observes the flag as set.
    window.setTimeout(() => {
      dragStartedRef.current = false;
    }, 0);
  };

  const handleBarActivate = (itemId: string) => {
    if (dragStartedRef.current) return;
    onActivateItem(itemId);
  };

  const handleBarHoverStart = (item: ReservationItem, anchorEl: HTMLElement) => {
    setHoverCardItem(item);
    setHoverCardAnchor(anchorEl);
  };

  const resolveDragTarget = (
    event: React.DragEvent<HTMLDivElement>,
    roomId: PhysicalRoomId
  ): ReservationMoveTarget | null => {
    if (dragGrabOffsetDays === null || !draggedItemId) return null;
    const draggedItem = items.find((candidate) => candidate.id === draggedItemId);
    const scrollContainer = scrollContainerRef.current;
    if (!draggedItem || !scrollContainer) return null;

    const durationDays = diffDaysIso(draggedItem.startDate, draggedItem.endDate);
    const pointerColumn = resolvePointerDateColumn(event.clientX, scrollContainer);
    const targetStartDate = addDaysIso(range.start, pointerColumn - dragGrabOffsetDays);
    const targetEndDate = addDaysIso(targetStartDate, durationDays);
    return { targetRoomId: roomId, targetStartDate, targetEndDate };
  };

  const handleRoomDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    roomId: PhysicalRoomId
  ) => {
    if (!draggedItemId) return;
    const target = resolveDragTarget(event, roomId);
    if (!target) return;
    event.preventDefault();

    const validation = getMoveValidation(draggedItemId, target);
    if (validation.status === "no-op") {
      event.dataTransfer.dropEffect = "none";
      setDragPreview(null);
      onDragFeedback(null);
      return;
    }
    if (validation.status === "conflict") {
      event.dataTransfer.dropEffect = "none";
      setDragPreview({ ...target, status: "invalid" });
      onDragFeedback(validation.conflict.message);
      return;
    }
    event.dataTransfer.dropEffect = "move";
    setDragPreview({ ...target, status: "valid" });
    onDragFeedback(null);
  };

  const handleRoomDragLeave = (
    event: React.DragEvent<HTMLDivElement>,
    roomId: PhysicalRoomId
  ) => {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) return;
    if (dragPreview?.targetRoomId === roomId) {
      setDragPreview(null);
      onDragFeedback(null);
    }
  };

  const handleRoomDrop = (event: React.DragEvent<HTMLDivElement>, roomId: PhysicalRoomId) => {
    event.preventDefault();
    const preview = dragPreview;
    setDragPreview(null);
    if (!draggedItemId) return;

    if (preview && preview.targetRoomId === roomId) {
      onProposeMove(draggedItemId, {
        targetRoomId: roomId,
        targetStartDate: preview.targetStartDate,
        targetEndDate: preview.targetEndDate,
      });
      return;
    }

    // Fallback: no matching preview was captured for this exact row (e.g.
    // `drop` fired without a preceding `dragover` on it) — resolve directly
    // from the drop event rather than silently doing nothing.
    const fallbackTarget = resolveDragTarget(event, roomId);
    if (fallbackTarget) {
      onProposeMove(draggedItemId, fallbackTarget);
    }
  };

  const hoverContext = hoverCardItem
    ? resolveHoverContext(hoverCardItem, physicalRooms, roomTypes)
    : null;

  return (
    <div className="rounded-b-2xl">
      <div
        ref={scrollContainerRef}
        className="max-h-[560px] overflow-auto"
        style={{ minWidth: "100%" }}
      >
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
                    {formatMonthDay(date)}
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
                      {roomItems.map((item) => {
                        const clip = clipToVisibleRange(item.startDate, item.endDate, range);
                        if (!clip) return null;
                        if (item.kind === "operational-block") {
                          return (
                            <TimelineBar
                              key={item.id}
                              item={item}
                              clip={clip}
                              isDragged={draggedItemId === item.id}
                              onDragStart={handleBarDragStart}
                              onDragEnd={handleBarDragEnd}
                              onActivate={handleBarActivate}
                              onHoverStart={handleBarHoverStart}
                              onHoverEnd={closeHoverCard}
                              primaryLabel="Block"
                              secondaryLabel={item.reason}
                              detailLabel={`${formatDisplayDate(item.startDate)} – ${formatDisplayDate(
                                item.endDate
                              )}`}
                              ariaLabel={`Operational block: ${item.reason} · ${formatDisplayDate(
                                item.startDate
                              )} – ${formatDisplayDate(item.endDate)}`}
                            />
                          );
                        }
                        return (
                          <TimelineBar
                            key={item.id}
                            item={item}
                            clip={clip}
                            isDragged={draggedItemId === item.id}
                            onDragStart={handleBarDragStart}
                            onDragEnd={handleBarDragEnd}
                            onActivate={handleBarActivate}
                            onHoverStart={handleBarHoverStart}
                            onHoverEnd={closeHoverCard}
                            primaryLabel={item.guestName}
                            secondaryLabel={`${sourceLabelFor(bookingSources, item.sourceId)} · Assigned`}
                            detailLabel={`${formatDisplayDate(item.startDate)} – ${formatDisplayDate(
                              item.endDate
                            )}`}
                            ariaLabel={`${item.guestName} · ${sourceLabelFor(
                              bookingSources,
                              item.sourceId
                            )} · Assigned · ${formatDisplayDate(item.startDate)} – ${formatDisplayDate(
                              item.endDate
                            )}`}
                          />
                        );
                      })}
                      {effectiveDragPreview && effectiveDragPreview.targetRoomId === room.id
                        ? (() => {
                            const previewClip = clipToVisibleRange(
                              effectiveDragPreview.targetStartDate,
                              effectiveDragPreview.targetEndDate,
                              range
                            );
                            if (!previewClip) return null;
                            const previewWidthPx = previewClip.span * DATE_COLUMN_WIDTH_PX - 6;
                            return (
                              <div
                                aria-hidden="true"
                                className={`pointer-events-none absolute top-1.5 bottom-1.5 rounded-md border-2 ${
                                  effectiveDragPreview.status === "valid"
                                    ? "border-success-500 bg-success-500/15"
                                    : "border-error-500 bg-error-500/15"
                                }`}
                                style={{
                                  left: previewClip.startCol * DATE_COLUMN_WIDTH_PX + 3,
                                  width: Math.max(previewWidthPx, DATE_COLUMN_WIDTH_PX - 6),
                                }}
                              />
                            );
                          })()
                        : null}
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
                            item={item}
                            clip={clip}
                            isDragged={draggedItemId === item.id}
                            onDragStart={handleBarDragStart}
                            onDragEnd={handleBarDragEnd}
                            onActivate={handleBarActivate}
                            onHoverStart={handleBarHoverStart}
                            onHoverEnd={closeHoverCard}
                            primaryLabel={item.guestName}
                            secondaryLabel={`${sourceLabelFor(bookingSources, item.sourceId)} · Unassigned`}
                            detailLabel={`${formatDisplayDate(item.startDate)} – ${formatDisplayDate(
                              item.endDate
                            )}`}
                            ariaLabel={`${item.guestName} · ${sourceLabelFor(
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

      {hoverCardItem && hoverCardAnchor && hoverContext?.roomType ? (
        <ReservationHoverCard
          item={hoverCardItem}
          anchorEl={hoverCardAnchor}
          bookingSources={bookingSources}
          physicalRoom={hoverContext.physicalRoom}
          roomType={hoverContext.roomType}
        />
      ) : null}
    </div>
  );
};

export default ReservationTimeline;
