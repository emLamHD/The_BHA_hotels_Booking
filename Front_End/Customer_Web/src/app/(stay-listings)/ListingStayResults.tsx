"use client";

import React, { FC, ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import RoomTypeStayCard from "@/components/RoomTypeStayCard";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { AvailabilityDraft, calculateNights } from "@/lib/api/availabilityValidation";
import { bookingStatusCopy, buildRoomDetailsHref, inProgressBookingTarget } from "@/lib/roomDetailsRoute";
import { LISTING_STAY_PATH, StayListingQuery, brandInfo, describeListingProblems, stayListingKey } from "@/lib/stayListingQuery";
import { ListingState, buildListingCards } from "@/lib/stayListingSearch";

export interface ListingStayResultsProps {
  query: StayListingQuery;
  state: ListingState;
  onRetry: () => void;
  onClear: () => void;
}

const Notice: FC<{ role: "status" | "alert"; children: ReactNode }> = ({ role, children }) => (
  <div
    role={role}
    className="flex flex-col items-center space-y-4 rounded-3xl border border-dashed border-neutral-300 px-4 py-16 text-center text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
  >
    {children}
  </div>
);

const isoToDisplay = (iso: string) => iso.split("-").reverse().join("/");

function summaryOf(search: AvailabilityDraft, nights: number | null): string {
  const children = Number(search.children);
  return [
    `${isoToDisplay(search.checkIn)} – ${isoToDisplay(search.checkOut)}${nights ? ` (${nights} đêm)` : ""}`,
    `${search.adults} người lớn${children > 0 ? `, ${children} trẻ em` : ""}`,
    `${search.rooms} phòng`,
  ].join(" · ");
}

/**
 * CUST-WEB-001-CP05a: what /listing-stay shows for the URL's query. It renders only a state made for the
 * query now in the URL (same key); until then — the first frame after a URL change — it shows a loading
 * notice, never the previous query's cards, prices or summary. Counts say room TYPES (or offers), never
 * physical rooms; a price is the server's quote for these dates, not a held room.
 */
const ListingStayResults: FC<ListingStayResultsProps> = ({ query, state, onRetry, onClear }) => {
  const { state: holdState } = useBookingHoldFlow();
  const inProgress = inProgressBookingTarget(holdState);

  const inProgressNotice = inProgress && (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-700 dark:bg-neutral-800 dark:text-primary-300"
    >
      <span>{bookingStatusCopy(inProgress.phase).message}</span>
      <Link href={buildRoomDetailsHref(inProgress) as Route} className="font-medium underline underline-offset-2">
        {bookingStatusCopy(inProgress.phase).action}
      </Link>
    </div>
  );

  const body = (): ReactNode => {
    if (state.kind === "idle" || state.key !== stayListingKey(query)) {
      return <Notice role="status">Đang tải…</Notice>;
    }

    if (state.kind === "invalid") {
      return (
        <Notice role="alert">
          <p className="text-base font-medium text-neutral-800 dark:text-neutral-100">Liên kết tìm phòng chưa hợp lệ</p>
          <ul className="space-y-1">
            {describeListingProblems(state.problems).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>Chọn ngày và số khách ở trên rồi bấm tìm, hoặc xoá bộ lọc để xem các loại phòng.</p>
          <ButtonSecondary onClick={onClear}>Xoá bộ lọc</ButtonSecondary>
        </Notice>
      );
    }

    if (state.kind === "unsupported-brand") {
      return (
        <Notice role="status">
          <p className="text-base font-medium text-neutral-800 dark:text-neutral-100">{brandInfo(state.brand).label}</p>
          <p>Chưa hỗ trợ đặt phòng trực tuyến.</p>
          <ButtonSecondary href={LISTING_STAY_PATH as Route}>Xem The BHA Riverside</ButtonSecondary>
        </Notice>
      );
    }

    const { catalog, availability, search } = state;
    if (catalog.status === "loading") return <Notice role="status">Đang tải loại phòng…</Notice>;
    if (catalog.status === "error") {
      return (
        <Notice role="alert">
          <p>{catalog.message}</p>
          <ButtonSecondary onClick={onRetry}>Thử lại</ButtonSecondary>
        </Notice>
      );
    }
    if (catalog.status === "missing") {
      return (
        <Notice role="status">
          <p>The BHA Riverside hiện chưa có trong hệ thống đặt phòng, nên chưa thể hiển thị phòng.</p>
          <ButtonSecondary onClick={onRetry}>Tải lại</ButtonSecondary>
        </Notice>
      );
    }
    if (catalog.status === "empty") {
      return (
        <Notice role="status">
          <p>The BHA Riverside chưa có loại phòng nào đang mở đặt.</p>
          <ButtonSecondary onClick={onRetry}>Tải lại</ButtonSecondary>
        </Notice>
      );
    }

    if (search && availability.status === "loading") return <Notice role="status">Đang tìm phòng…</Notice>;
    if (search && availability.status === "error") {
      return (
        <Notice role="alert">
          <p>{availability.message}</p>
          {availability.retryable && <ButtonSecondary onClick={onRetry}>Thử lại</ButtonSecondary>}
        </Notice>
      );
    }

    const offers = search && availability.status === "success" ? availability.offers : null;
    const { cards } = buildListingCards(catalog.property, catalog.roomTypes, search, offers);

    return (
      <>
        <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300" role="status">
          {search ? (
            <>
              {cards.length > 0 && (
                <>
                  {cards.length} loại phòng còn trống
                  <span className="mx-2">·</span>
                </>
              )}
              {summaryOf(search, calculateNights(search.checkIn, search.checkOut))}
              {cards.length > 0 && (
                <>
                  <br />
                  Giá là kết quả tại thời điểm tìm, chưa giữ phòng.
                </>
              )}
            </>
          ) : (
            <>
              {cards.length} loại phòng tại {catalog.property.name ?? "The BHA Riverside"}
              <span className="mx-2">·</span>
              Chọn ngày để xem giá
            </>
          )}
        </p>
        {cards.length === 0 ? (
          <Notice role="status">
            <p>Không có phòng phù hợp cho tìm kiếm này.</p>
            <p>Hãy đổi ngày hoặc số khách ở trên rồi tìm lại.</p>
          </Notice>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((card) => (
              <RoomTypeStayCard
                key={card.roomType.id}
                property={catalog.property}
                roomType={card.roomType}
                href={card.href}
                price={card.quote ? { state: "quoted", quote: card.quote } : { state: "none" }}
                showRating={false}
                showWishlist={false}
              />
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div>
      {inProgressNotice}
      {body()}
    </div>
  );
};

export default ListingStayResults;
