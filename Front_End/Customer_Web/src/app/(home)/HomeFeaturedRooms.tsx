"use client";

import React, { FC, useEffect, useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import SectionGridFeaturePlaces from "@/components/SectionGridFeaturePlaces";
import RoomTypeStayCard, { RoomCardPrice } from "@/components/RoomTypeStayCard";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { useStaySearch } from "@/components/StaySearchProvider";
import { DEFAULT_FEATURED_TAB, FEATURED_TAB_LABELS } from "@/lib/featuredBrands";
import { bookingStatusCopy, buildRoomDetailsHref, inProgressBookingTarget } from "@/lib/roomDetailsRoute";
import { quoteForRoomType } from "@/lib/roomQuote";
import { SHOWCASE_SECTION_NAVIGATION_EVENT } from "@/lib/routePolicy";
import { createAnchorAlignment } from "@/lib/anchorAlignment";

const ALIGNED_SECTIONS = new Set(["rooms"]);
const USER_TAKEOVER_EVENTS = ["wheel", "touchstart", "keydown", "mousedown"] as const;
const ALIGNMENT_WINDOW_MS = 5000;

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the home page's "Featured places to stay". The template's section and
 * StayCard2 cards, three static brand tabs; The BHA Riverside (default) lists the room TYPES of the
 * Property whose slug is `the-bha-riverside`, House and Villa say they are coming and call nothing.
 * The hero's search (shared draft) puts real offers on the cards; each card opens /listing-stay-detail
 * for its own RoomType, carrying a valid search, and searching, holding and confirming go on there.
 */
const HomeFeaturedRooms: FC = () => {
  const ctx = useStaySearch();
  const { state: holdState } = useBookingHoldFlow();

  useEffect(() => {
    ctx?.ensureCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the section a visitor jumped to (#rooms) in view while content settles (see anchorAlignment).
  const sectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = sectionRef.current;
    if (!container) return;
    const alignment = createAnchorAlignment<HTMLElement>({
      container,
      sections: ALIGNED_SECTIONS,
      navigationEvent: SHOWCASE_SECTION_NAVIGATION_EVENT,
      takeoverEvents: USER_TAKEOVER_EVENTS,
      windowMs: ALIGNMENT_WINDOW_MS,
      environment: {
        window,
        getElementById: (id) => document.getElementById(id),
        createObserver: (onResize) => new ResizeObserver(onResize),
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
    });
    return () => alignment.dispose();
  }, []);

  const inProgress = inProgressBookingTarget(holdState);
  const activeTab = ctx?.activeTab ?? DEFAULT_FEATURED_TAB;

  const priceFor = (roomTypeId: string): RoomCardPrice => {
    if (!ctx) return { state: "none" };
    const { search } = ctx;
    if (search.status === "loading") return { state: "loading" };
    if (search.status !== "success") return { state: "none" };
    const quote = quoteForRoomType(search.offers, roomTypeId);
    return quote ? { state: "quoted", quote } : { state: "unavailable" };
  };

  const renderRiverside = () => {
    if (!ctx) return null;
    const { propsStatus, propsError, riverside, roomsStatus, roomsError, roomTypes, search } = ctx;
    if (propsStatus === "idle" || propsStatus === "loading") return <Notice role="status">Đang tải phòng…</Notice>;
    if (propsStatus === "error") {
      return (
        <Notice role="alert">
          <p>{propsError}</p>
          <ButtonSecondary onClick={ctx.retryProperties}>Thử lại</ButtonSecondary>
        </Notice>
      );
    }
    if (!riverside) {
      return (
        <Notice role="status">
          The BHA Riverside hiện chưa có trong hệ thống đặt phòng, nên chưa thể hiển thị phòng.
        </Notice>
      );
    }
    if (roomsStatus === "idle" || roomsStatus === "loading") return <Notice role="status">Đang tải loại phòng…</Notice>;
    if (roomsStatus === "error") {
      return (
        <Notice role="alert">
          <p>{roomsError}</p>
          <ButtonSecondary onClick={ctx.retryRoomTypes}>Thử lại</ButtonSecondary>
        </Notice>
      );
    }
    if (roomTypes.length === 0) {
      return <Notice role="status">The BHA Riverside chưa có loại phòng nào đang mở đặt.</Notice>;
    }
    return (
      <>
        {search.query && (
          <p aria-live="polite" className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">
            {search.status === "loading" && "Đang tìm phòng…"}
            {search.status === "error" && (
              <span role="alert" className="text-red-600 dark:text-red-400">
                {search.message}{" "}
                <button type="button" onClick={ctx.submit} className="underline underline-offset-2">
                  Thử lại
                </button>
              </span>
            )}
            {search.status === "success" && (
              <>
                Kết quả cho {search.query.checkIn} → {search.query.checkOut} · {search.query.adults} người lớn
                {Number(search.query.children) > 0 ? `, ${search.query.children} trẻ em` : ""} · {search.query.rooms} phòng
              </>
            )}
          </p>
        )}
        <div className="grid gap-6 md:gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {roomTypes.map((roomType) => (
            <RoomTypeStayCard
              key={roomType.id}
              property={riverside}
              roomType={roomType}
              href={buildRoomDetailsHref(
                { propertyId: riverside.id, roomTypeId: roomType.id },
                search.status === "success" ? search.query : null
              )}
              price={priceFor(roomType.id)}
            />
          ))}
        </div>
      </>
    );
  };

  return (
    <div ref={sectionRef}>
      <SectionGridFeaturePlaces
        id="rooms"
        heading="Featured places to stay"
        subHeading="Chọn thương hiệu rồi chọn loại phòng — giá và đặt phòng theo ngày bạn chọn."
        tabs={FEATURED_TAB_LABELS}
        tabActive={activeTab}
        onClickTab={ctx?.setActiveTab}
      >
        {inProgress && (
          <div
            role="status"
            className="mb-6 flex flex-col gap-3 rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-700 dark:bg-neutral-800 dark:text-primary-300"
          >
            <span>{bookingStatusCopy(inProgress.phase).message}</span>
            <Link
              href={buildRoomDetailsHref(inProgress) as Route}
              className="font-medium underline underline-offset-2"
            >
              {bookingStatusCopy(inProgress.phase).action}
            </Link>
          </div>
        )}

        {activeTab === DEFAULT_FEATURED_TAB ? (
          renderRiverside()
        ) : (
          <Notice role="status">
            <p className="text-base font-medium text-neutral-800 dark:text-neutral-100">{activeTab}</p>
            <p>Sắp ra mắt — chưa hỗ trợ đặt phòng trực tuyến.</p>
          </Notice>
        )}
      </SectionGridFeaturePlaces>
    </div>
  );
};

const Notice: FC<{ role: "status" | "alert"; children: React.ReactNode }> = ({ role, children }) => (
  <div
    role={role}
    aria-live={role === "status" ? "polite" : undefined}
    className="flex flex-col items-center space-y-4 rounded-3xl border border-dashed border-neutral-300 px-4 py-16 text-center text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
  >
    {children}
  </div>
);

export default HomeFeaturedRooms;
