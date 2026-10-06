"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getProperties } from "@/lib/api/propertyService";
import { getRoomTypes } from "@/lib/api/roomTypeService";
import { searchAvailability } from "@/lib/api/availabilityService";
import { AvailabilityOfferDto } from "@/lib/api/availabilityTypes";
import { AvailabilityDraft, AvailabilityFieldErrors, validateAvailabilityDraft } from "@/lib/api/availabilityValidation";
import { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { ApiConfigError, ApiHttpError, ApiNetworkError, ApiValidationError } from "@/lib/api/errors";
import { isRequestCancelledError } from "@/lib/api/httpClient";
import { DEFAULT_FEATURED_TAB, FEATURED_BRAND_TABS, findPropertyBySlug } from "@/lib/featuredBrands";
import { SHOWCASE_SECTION_NAVIGATION_EVENT } from "@/lib/routePolicy";
import { StaySearchDraft, initialStayDraft, toAvailabilityDraft } from "@/lib/staySearch";

export type CatalogStatus = "idle" | "loading" | "success" | "error";
export type SearchStatus = "idle" | "invalid" | "loading" | "success" | "error";

export interface StaySearchState {
  status: SearchStatus;
  /** The validated search the offers belong to; null until a search ran. */
  query: AvailabilityDraft | null;
  offers: AvailabilityOfferDto[];
  message: string | null;
}

export interface StaySearchContextValue {
  draft: StaySearchDraft;
  updateDraft: (patch: Partial<StaySearchDraft>) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  propsStatus: CatalogStatus;
  propsError: string | null;
  riverside: PropertyDto | undefined;
  roomsStatus: CatalogStatus;
  roomsError: string | null;
  roomTypes: RoomTypeDto[];
  ensureCatalog: () => void;
  retryProperties: () => void;
  retryRoomTypes: () => void;
  search: StaySearchState;
  /** Validates the draft and, for The BHA Riverside, asks the booking system for the offers. */
  submit: () => void;
}

const StaySearchContext = createContext<StaySearchContextValue | null>(null);

/** The shared search, or null outside the provider (the template's own demo forms then keep local state). */
export function useStaySearch(): StaySearchContextValue | null {
  return useContext(StaySearchContext);
}

const RIVERSIDE_SLUG = FEATURED_BRAND_TABS[0].slug as string;
const IDLE_SEARCH: StaySearchState = { status: "idle", query: null, offers: [], message: null };

function describeError(error: unknown, what: string): string {
  if (error instanceof ApiConfigError) return `Dịch vụ ${what} chưa được cấu hình đúng.`;
  if (error instanceof ApiNetworkError) {
    return `Không kết nối được tới dịch vụ ${what}. Kiểm tra kết nối rồi thử lại.`;
  }
  if (error instanceof ApiValidationError) {
    return Object.values(error.errors).flat()[0] ?? error.problem.detail ?? error.problem.title;
  }
  if (error instanceof ApiHttpError) return error.problem.detail ?? error.problem.title;
  return `Đã có lỗi khi tải ${what}.`;
}

/** Why a draft cannot be searched, in the visitor's language. */
export function describeDraftProblem(errors: AvailabilityFieldErrors): string {
  if (errors.checkIn || (errors.checkOut && !errors.checkIn && /required/i.test(errors.checkOut))) {
    return "Chọn ngày nhận phòng và trả phòng.";
  }
  return Object.values(errors).find(Boolean) ?? "Kiểm tra lại ngày và số khách.";
}

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the stay search shared by the hero, the mobile search modal and the
 * Featured cards. It also owns the Riverside catalog read, once, so coming back to the home page does
 * not reload it. The search it runs is a read-only availability request: it never creates a hold and
 * does not touch the booking-hold flow.
 */
export function StaySearchProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [draft, setDraft] = useState<StaySearchDraft>(initialStayDraft);
  const [activeTab, setActiveTab] = useState<string>(DEFAULT_FEATURED_TAB);

  const [propsStatus, setPropsStatus] = useState<CatalogStatus>("idle");
  const [properties, setProperties] = useState<PropertyDto[]>([]);
  const [propsError, setPropsError] = useState<string | null>(null);
  const propsRequest = useRef<AbortController | null>(null);
  const requested = useRef(false);

  const [roomsStatus, setRoomsStatus] = useState<CatalogStatus>("idle");
  const [roomTypes, setRoomTypes] = useState<RoomTypeDto[]>([]);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const roomsRequest = useRef<AbortController | null>(null);

  const [search, setSearch] = useState<StaySearchState>(IDLE_SEARCH);
  const searchRequest = useRef<AbortController | null>(null);
  const searchId = useRef(0);
  const pending = useRef<AvailabilityDraft | null>(null);

  const riverside = propsStatus === "success" ? findPropertyBySlug(properties, RIVERSIDE_SLUG) : undefined;
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

  const ensureCatalog = useCallback(() => {
    if (requested.current) return;
    requested.current = true;
    loadProperties();
  }, [loadProperties]);

  const retryProperties = useCallback(() => {
    requested.current = true;
    loadProperties();
  }, [loadProperties]);

  // Room types follow the Riverside Property's id.
  useEffect(() => {
    if (!riversideId) {
      roomsRequest.current?.abort();
      setRoomTypes([]);
      setRoomsStatus("idle");
      return;
    }
    loadRoomTypes(riversideId);
    return () => roomsRequest.current?.abort();
  }, [riversideId, loadRoomTypes]);

  const retryRoomTypes = useCallback(() => {
    if (riversideId) loadRoomTypes(riversideId);
  }, [riversideId, loadRoomTypes]);

  const runQuote = useCallback((propertyId: string, query: AvailabilityDraft) => {
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    const id = ++searchId.current;
    setSearch({ status: "loading", query, offers: [], message: null });
    const validated = validateAvailabilityDraft(query);
    if (!validated.ok) return; // callers validate first; this only narrows the type
    searchAvailability(propertyId, validated.value, { signal: controller.signal })
      .then((offers) => {
        if (id !== searchId.current || controller.signal.aborted) return;
        setSearch({ status: "success", query, offers, message: null });
      })
      .catch((error) => {
        if (isRequestCancelledError(error) || controller.signal.aborted || id !== searchId.current) return;
        setSearch({ status: "error", query, offers: [], message: describeError(error, "tìm phòng") });
      });
  }, []);

  const scrollToRooms = useCallback(() => {
    if (pathname !== "/") {
      router.push("/#rooms" as never);
      return;
    }
    // Same-document jump: a native fragment change, or the explicit event when the hash already is #rooms.
    window.requestAnimationFrame(() => {
      const target = document.getElementById("rooms");
      if (!target) return;
      if (window.location.hash === "#rooms") {
        target.scrollIntoView({ block: "start" });
        window.dispatchEvent(new Event(SHOWCASE_SECTION_NAVIGATION_EVENT));
      } else {
        window.location.hash = "rooms";
      }
    });
  }, [pathname, router]);

  // A search asked for before the catalog arrived runs as soon as it does (or reports why it cannot).
  useEffect(() => {
    const query = pending.current;
    if (!query) return;
    if (propsStatus === "success") {
      pending.current = null;
      if (riverside) runQuote(riverside.id, query);
      else setSearch({ status: "error", query, offers: [], message: "The BHA Riverside hiện chưa có trong hệ thống đặt phòng." });
    } else if (propsStatus === "error") {
      pending.current = null;
      setSearch({ status: "error", query, offers: [], message: propsError ?? "Không tải được danh sách chỗ nghỉ." });
    }
  }, [propsStatus, propsError, riverside, runQuote]);

  const submit = useCallback(() => {
    const brand = draft.brand;
    setActiveTab(brand);
    if (brand !== DEFAULT_FEATURED_TAB) {
      // House and Villa have no catalog yet: no availability request, never another property's rooms.
      searchRequest.current?.abort();
      searchId.current += 1;
      pending.current = null;
      setSearch(IDLE_SEARCH);
      scrollToRooms();
      return;
    }
    const query = toAvailabilityDraft(draft);
    const validated = validateAvailabilityDraft(query);
    if (!validated.ok) {
      searchRequest.current?.abort();
      searchId.current += 1;
      setSearch({ status: "invalid", query: null, offers: [], message: describeDraftProblem(validated.errors) });
      return;
    }
    ensureCatalog();
    scrollToRooms();
    if (propsStatus === "success") {
      if (riverside) runQuote(riverside.id, query);
      else setSearch({ status: "error", query, offers: [], message: "The BHA Riverside hiện chưa có trong hệ thống đặt phòng." });
    } else {
      pending.current = query;
      setSearch({ status: "loading", query, offers: [], message: null });
      if (propsStatus === "error") retryProperties();
    }
  }, [draft, ensureCatalog, propsStatus, retryProperties, riverside, runQuote, scrollToRooms]);

  useEffect(
    () => () => {
      propsRequest.current?.abort();
      roomsRequest.current?.abort();
      searchRequest.current?.abort();
    },
    []
  );

  const updateDraft = useCallback((patch: Partial<StaySearchDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const value = useMemo<StaySearchContextValue>(
    () => ({
      draft,
      updateDraft,
      activeTab,
      setActiveTab,
      propsStatus,
      propsError,
      riverside,
      roomsStatus,
      roomsError,
      roomTypes,
      ensureCatalog,
      retryProperties,
      retryRoomTypes,
      search,
      submit,
    }),
    [draft, updateDraft, activeTab, propsStatus, propsError, riverside, roomsStatus, roomsError, roomTypes, ensureCatalog, retryProperties, retryRoomTypes, search, submit]
  );

  return <StaySearchContext.Provider value={value}>{children}</StaySearchContext.Provider>;
}
