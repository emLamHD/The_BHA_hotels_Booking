"use client";

import React, { FC, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import SectionGridFeaturePlaces from "@/components/SectionGridFeaturePlaces";
import RoomTypeStayCard from "@/components/RoomTypeStayCard";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { getProperties } from "@/lib/api/propertyService";
import { getRoomTypes } from "@/lib/api/roomTypeService";
import { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { ApiConfigError, ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import { isRequestCancelledError } from "@/lib/api/httpClient";
import {
  DEFAULT_FEATURED_TAB,
  FEATURED_TAB_LABELS,
  featuredTabByLabel,
  findPropertyBySlug,
} from "@/lib/featuredBrands";
import { bookingStatusCopy, buildRoomDetailsHref, inProgressBookingTarget } from "@/lib/roomDetailsRoute";
import { SHOWCASE_SECTION_NAVIGATION_EVENT } from "@/lib/routePolicy";
import { createAnchorAlignment } from "@/lib/anchorAlignment";

type LoadStatus = "loading" | "success" | "error";

const ALIGNED_SECTIONS = new Set(["rooms"]);
const USER_TAKEOVER_EVENTS = ["wheel", "touchstart", "keydown", "mousedown"] as const;
const ALIGNMENT_WINDOW_MS = 5000;

function describeError(error: unknown, what: string): string {
  if (error instanceof ApiConfigError) return `Dịch vụ ${what} chưa được cấu hình đúng.`;
  if (error instanceof ApiNetworkError) {
    return `Không kết nối được tới dịch vụ ${what}. Kiểm tra kết nối rồi thử lại.`;
  }
  if (error instanceof ApiHttpError) return error.problem.detail ?? error.problem.title;
  return `Đã có lỗi khi tải ${what}.`;
}

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the home page's "Featured places to stay". Three static brand tabs;
 * The BHA Riverside (default) lists the room TYPES of the Property whose slug is `the-bha-riverside`,
 * House and Villa say they are coming and call nothing. Each card opens /listing-stay-detail for its
 * own RoomType; searching, holding and confirming happen there.
 */
const HomeFeaturedRooms: FC = () => {
  const [activeTab, setActiveTab] = useState<string>(DEFAULT_FEATURED_TAB);

  const [propsStatus, setPropsStatus] = useState<LoadStatus>("loading");
  const [properties, setProperties] = useState<PropertyDto[]>([]);
  const [propsError, setPropsError] = useState<string | null>(null);
  const propsRequest = useRef<AbortController | null>(null);

  const [roomsStatus, setRoomsStatus] = useState<LoadStatus>("loading");
  const [roomTypes, setRoomTypes] = useState<RoomTypeDto[]>([]);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const roomsRequest = useRef<AbortController | null>(null);

  const riversideSlug = featuredTabByLabel(DEFAULT_FEATURED_TAB)?.slug ?? "";
  const riverside =
    propsStatus === "success" ? findPropertyBySlug(properties, riversideSlug) : undefined;
  const riversideId = riverside?.id;

  const loadProperties = useCallback(() => {
    propsRequest.current?.abort();
    const controller = new AbortController();
    propsRequest.current = controller;
    setPropsStatus("loading");
    setPropsError(null);
    getProperties({ signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setProperties(data);
        setPropsStatus("success");
      })
      .catch((error) => {
        if (isRequestCancelledError(error) || controller.signal.aborted) return;
        setPropsError(describeError(error, "chỗ nghỉ"));
        setPropsStatus("error");
      });
  }, []);

  const loadRoomTypes = useCallback((propertyId: string) => {
    roomsRequest.current?.abort();
    const controller = new AbortController();
    roomsRequest.current = controller;
    setRoomsStatus("loading");
    setRoomsError(null);
    getRoomTypes(propertyId, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setRoomTypes(data);
        setRoomsStatus("success");
      })
      .catch((error) => {
        if (isRequestCancelledError(error) || controller.signal.aborted) return;
        setRoomsError(describeError(error, "loại phòng"));
        setRoomsStatus("error");
      });
  }, []);

  useEffect(() => {
    loadProperties();
    return () => propsRequest.current?.abort();
  }, [loadProperties]);

  // Room types follow the Riverside Property's id; a different id (or none) drops the old list.
  useEffect(() => {
    if (!riversideId) {
      roomsRequest.current?.abort();
      setRoomTypes([]);
      return;
    }
    loadRoomTypes(riversideId);
    return () => roomsRequest.current?.abort();
  }, [riversideId, loadRoomTypes]);

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

  const { state: holdState } = useBookingHoldFlow();
  const inProgress = inProgressBookingTarget(holdState);

  const renderRiverside = () => {
    if (propsStatus === "loading") return <Notice role="status">Đang tải phòng…</Notice>;
    if (propsStatus === "error") {
      return (
        <Notice role="alert">
          <p>{propsError}</p>
          <ButtonSecondary onClick={loadProperties}>Thử lại</ButtonSecondary>
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
    if (roomsStatus === "loading") return <Notice role="status">Đang tải loại phòng…</Notice>;
    if (roomsStatus === "error") {
      return (
        <Notice role="alert">
          <p>{roomsError}</p>
          <ButtonSecondary onClick={() => loadRoomTypes(riverside.id)}>Thử lại</ButtonSecondary>
        </Notice>
      );
    }
    if (roomTypes.length === 0) {
      return <Notice role="status">The BHA Riverside chưa có loại phòng nào đang mở đặt.</Notice>;
    }
    return (
      <div className="grid gap-6 md:gap-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {roomTypes.map((roomType) => (
          <RoomTypeStayCard key={roomType.id} property={riverside} roomType={roomType} />
        ))}
      </div>
    );
  };

  return (
    <div ref={sectionRef}>
      <SectionGridFeaturePlaces
        id="rooms"
        heading="Featured places to stay"
        subHeading="Chọn thương hiệu rồi chọn loại phòng — ngày, giá và đặt phòng ở trang chi tiết."
        tabs={FEATURED_TAB_LABELS}
        tabActive={activeTab}
        onClickTab={setActiveTab}
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
