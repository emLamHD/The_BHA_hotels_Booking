"use client";

import React, { FC, ReactNode, useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import RoomTypeStayCard from "@/components/RoomTypeStayCard";
import Heading from "@/shared/Heading";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { useStaySearch } from "@/components/StaySearchProvider";
import { bookingStatusCopy, buildRoomDetailsHref, inProgressBookingTarget } from "@/lib/roomDetailsRoute";
import { HOME_SECTION, RESULTS_PATH, RIVERSIDE_NAME } from "@/lib/riversideHomeContent";

import { useI18n } from "@/lib/i18n/I18nProvider";
/**
 * CUST-WEB-001-CP08a: the home page's room types. The real room types of the Property whose slug is
 * `the-bha-riverside`, exactly the ones the booking system returns (the count is whatever it is), as
 * browse cards: a photograph, the name, the maximum occupancy, "Chọn ngày để xem giá". No price is shown
 * here — a price belongs to dates, and dated prices live on the results page and the room page, which ask
 * the server themselves. A card links to its room page by its own two ids and carries no search.
 * House and Villa are not offered: they are not bookable online.
 */
const HomeFeaturedRooms: FC = () => {
  const { t, content } = useI18n();
  const ctx = useStaySearch();
  const { state: holdState } = useBookingHoldFlow();

  useEffect(() => {
    ctx?.ensureCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inProgress = inProgressBookingTarget(holdState);

  const renderBody = (): ReactNode => {
    if (!ctx) return null;
    const { propsStatus, propsError, riverside, roomsStatus, roomsError, roomTypes } = ctx;
    if (propsStatus === "idle" || propsStatus === "loading") return <Notice role="status">{t("customer.home.homeFeaturedRooms.loadingRooms")}</Notice>;
    if (propsStatus === "error") {
      return (
        <Notice role="alert">
          <p>{propsError}</p>
          <ButtonSecondary onClick={ctx.retryProperties}>{t("customer.home.homeFeaturedRooms.tryAgain")}</ButtonSecondary>
        </Notice>
      );
    }
    if (!riverside) {
      return (
        <Notice role="status">
          {t("customer.home.homeFeaturedRooms.isNotInTheBooking", { RIVERSIDENAME: RIVERSIDE_NAME })}</Notice>
      );
    }
    if (roomsStatus === "idle" || roomsStatus === "loading") return <Notice role="status">{t("customer.home.homeFeaturedRooms.loadingRoomTypes")}</Notice>;
    if (roomsStatus === "error") {
      return (
        <Notice role="alert">
          <p>{roomsError}</p>
          <ButtonSecondary onClick={ctx.retryRoomTypes}>{t("customer.home.homeFeaturedRooms.tryAgain")}</ButtonSecondary>
        </Notice>
      );
    }
    if (roomTypes.length === 0) {
      return <Notice role="status">{t("customer.home.homeFeaturedRooms.hasNoRoomTypesYet", { RIVERSIDENAME: RIVERSIDE_NAME })}</Notice>;
    }
    return (
      <>
        <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">
          {t("customer.stayList.countAt", { count: roomTypes.length, property: content("property", riverside.id, "name", riverside.name ?? RIVERSIDE_NAME) })}
          <span className="mx-2">·</span>{t("customer.home.homeFeaturedRooms.chooseDatesToSeePrices")}</p>
        <div className="grid gap-6 sm:grid-cols-2 md:gap-8 lg:grid-cols-3">
          {roomTypes.map((roomType) => (
            <RoomTypeStayCard
              key={roomType.id}
              property={riverside}
              roomType={roomType}
              href={buildRoomDetailsHref({ propertyId: riverside.id, roomTypeId: roomType.id })}
              price={{ state: "none" }}
              showRating={false}
              showWishlist={false}
            />
          ))}
        </div>
      </>
    );
  };

  return (
    <section id={HOME_SECTION.rooms} aria-labelledby="rooms-heading" className="nc-HomeFeaturedRooms relative scroll-mt-24">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Heading
          id="rooms-heading"
          className="text-neutral-900 dark:text-neutral-50"
          desc={t("customer.home.homeFeaturedRooms.chooseAnApartmentTypeThen")}
        >{t("customer.home.homeFeaturedRooms.roomTypesAt", { RIVERSIDENAME: RIVERSIDE_NAME })}
        </Heading>
        <span className="flex-shrink-0">
          <ButtonSecondary href={RESULTS_PATH as Route} className="!leading-none">
            <div className="flex items-center justify-center">
              <span>{t("customer.home.homeFeaturedRooms.viewAllRoomTypes")}</span>
              <ArrowRightIcon aria-hidden="true" className="ml-3 h-5 w-5" />
            </div>
          </ButtonSecondary>
        </span>
      </div>

      {inProgress && (
        <div
          role="status"
          className="mb-6 flex flex-col gap-3 rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-700 dark:bg-neutral-800 dark:text-primary-300"
        >
          <span>{bookingStatusCopy(inProgress.phase, t).message}</span>
          <Link href={buildRoomDetailsHref(inProgress) as Route} className="font-medium underline underline-offset-2">
            {bookingStatusCopy(inProgress.phase, t).action}
          </Link>
        </div>
      )}

      {renderBody()}
    </section>
  );
};

const Notice: FC<{ role: "status" | "alert"; children: ReactNode }> = ({ role, children }) => (
  <div
    role={role}
    aria-live={role === "status" ? "polite" : undefined}
    className="flex flex-col items-center space-y-4 rounded-3xl border border-dashed border-neutral-300 px-4 py-16 text-center text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
  >
    {children}
  </div>
);

export default HomeFeaturedRooms;
