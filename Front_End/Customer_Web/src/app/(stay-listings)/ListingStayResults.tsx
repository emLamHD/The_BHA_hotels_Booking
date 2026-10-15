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
import { useApiMessage } from "@/lib/i18n/apiMessage";
import { useDateFormat } from "@/lib/i18n/dates";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Translate } from "@/lib/i18n/types";

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

/** "15 Oct – 18 Oct 2026 (3 nights) · 2 adults, 1 child · 1 room": each count is its own plural message. */
function summaryOf(search: AvailabilityDraft, nights: number | null, t: Translate, dates: ReturnType<typeof useDateFormat>): string {
  const children = Number(search.children);
  const party = [t("customer.booking.adults", { adults: Number(search.adults) })];
  if (children > 0) party.push(t("customer.booking.children", { children }));
  return [
    `${dates.stayDate(search.checkIn)} – ${dates.stayDate(search.checkOut)}${nights ? ` (${t("customer.booking.nights", { nights })})` : ""}`,
    party.join(", "),
    t("customer.booking.rooms", { rooms: Number(search.rooms) }),
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
  const { t, content } = useI18n();
  const dates = useDateFormat();
  const apiMessage = useApiMessage();
  const inProgress = inProgressBookingTarget(holdState);

  const inProgressNotice = inProgress && (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-700 dark:bg-neutral-800 dark:text-primary-300"
    >
      <span>{bookingStatusCopy(inProgress.phase, t).message}</span>
      <Link href={buildRoomDetailsHref(inProgress) as Route} className="font-medium underline underline-offset-2">
        {bookingStatusCopy(inProgress.phase, t).action}
      </Link>
    </div>
  );

  const body = (): ReactNode => {
    if (state.kind === "idle" || state.key !== stayListingKey(query)) {
      return <Notice role="status">{t("customer.stayList.loading")}</Notice>;
    }

    if (state.kind === "invalid") {
      return (
        <Notice role="alert">
          <p className="text-base font-medium text-neutral-800 dark:text-neutral-100">{t("customer.stayList.invalid.title")}</p>
          <ul className="space-y-1">
            {describeListingProblems(state.problems, t).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>{t("customer.stayList.invalid.hint")}</p>
          <ButtonSecondary onClick={onClear}>{t("customer.stayList.clearFilters")}</ButtonSecondary>
        </Notice>
      );
    }

    if (state.kind === "unsupported-brand") {
      return (
        <Notice role="status">
          <p className="text-base font-medium text-neutral-800 dark:text-neutral-100">{brandInfo(state.brand).label}</p>
          <p>{t("customer.stayList.unsupportedBrand")}</p>
          <ButtonSecondary href={LISTING_STAY_PATH as Route}>{t("customer.stayList.viewRiverside")}</ButtonSecondary>
        </Notice>
      );
    }

    const { catalog, availability, search } = state;
    if (catalog.status === "loading") return <Notice role="status">{t("customer.stayList.loadingRooms")}</Notice>;
    if (catalog.status === "error") {
      return (
        <Notice role="alert">
          <p>{apiMessage(catalog.message)}</p>
          <ButtonSecondary onClick={onRetry}>{t("customer.common.retry")}</ButtonSecondary>
        </Notice>
      );
    }
    if (catalog.status === "missing") {
      return (
        <Notice role="status">
          <p>{t("customer.stayList.missing")}</p>
          <ButtonSecondary onClick={onRetry}>{t("customer.stayList.reload")}</ButtonSecondary>
        </Notice>
      );
    }
    if (catalog.status === "empty") {
      return (
        <Notice role="status">
          <p>{t("customer.stayList.empty")}</p>
          <ButtonSecondary onClick={onRetry}>{t("customer.stayList.reload")}</ButtonSecondary>
        </Notice>
      );
    }

    if (search && availability.status === "loading") return <Notice role="status">{t("customer.stayList.searching")}</Notice>;
    if (search && availability.status === "error") {
      return (
        <Notice role="alert">
          <p>{apiMessage(availability.message)}</p>
          {availability.retryable && <ButtonSecondary onClick={onRetry}>{t("customer.common.retry")}</ButtonSecondary>}
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
                  {t("customer.stayList.countAvailable", { count: cards.length })}
                  <span className="mx-2">·</span>
                </>
              )}
              {summaryOf(search, calculateNights(search.checkIn, search.checkOut), t, dates)}
              {cards.length > 0 && (
                <>
                  <br />
                  {t("customer.stayList.priceNote")}
                </>
              )}
            </>
          ) : (
            <>
              {t("customer.stayList.countAt", { count: cards.length, property: content("property", catalog.property.id, "name", catalog.property.name ?? "The BHA Riverside") })}
              <span className="mx-2">·</span>
              {t("customer.stay.pickDates")}
            </>
          )}
        </p>
        {cards.length === 0 ? (
          <Notice role="status">
            <p>{t("customer.stayList.noMatch.title")}</p>
            <p>{t("customer.stayList.noMatch.hint")}</p>
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
