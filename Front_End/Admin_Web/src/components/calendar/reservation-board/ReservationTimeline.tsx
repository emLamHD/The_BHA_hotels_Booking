import React from "react";
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
  RoomType,
  RoomTypeId,
  TimelineItem,
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

interface TimelineBarProps {
  clip: ClippedSpan;
  title: string;
  primaryLabel: string;
  secondaryLabel: string;
  detailLabel?: string;
  variant: "assigned" | "unassigned" | "block";
}

const TimelineBar: React.FC<TimelineBarProps> = ({
  clip,
  title,
  primaryLabel,
  secondaryLabel,
  detailLabel,
  variant,
}) => {
  const widthPx = clip.span * DATE_COLUMN_WIDTH_PX - 6;
  const showDetail = widthPx >= WIDE_BAR_THRESHOLD_PX && Boolean(detailLabel);

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
      className={`absolute top-1.5 bottom-1.5 flex flex-col justify-center overflow-hidden rounded-md px-2 py-1 text-xs leading-tight ${variantClassName} ${
        clip.clippedStart ? "rounded-l-none border-l-4" : ""
      } ${clip.clippedEnd ? "rounded-r-none border-r-4" : ""}`}
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
}) => {
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
                  <div key={room.id} className="flex">
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
