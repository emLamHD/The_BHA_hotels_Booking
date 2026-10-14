"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getProperties } from "@/lib/api/propertyService";
import { getRoomTypes } from "@/lib/api/roomTypeService";
import { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { isRequestCancelledError } from "@/lib/api/httpClient";
import { findPropertyBySlug, FEATURED_BRAND_TABS } from "@/lib/featuredBrands";
import { createHomeSearchDispatcher, HomeSearchDispatcher, HomeSearchOutcome } from "@/lib/homepageSearch";
import { describeListingError } from "@/lib/stayListingSearch";
import { StaySearchDraft, initialStayDraft } from "@/lib/staySearch";

export type CatalogStatus = "idle" | "loading" | "success" | "error";

/** A Search that could not start, kept for the form that is showing it (`id` changes on every attempt). */
export interface SearchProblem {
  id: number;
  message: string;
}

export interface StaySearchContextValue {
  draft: StaySearchDraft;
  updateDraft: (patch: Partial<StaySearchDraft>) => void;
  propsStatus: CatalogStatus;
  propsError: string | null;
  riverside: PropertyDto | undefined;
  roomsStatus: CatalogStatus;
  roomsError: string | null;
  roomTypes: RoomTypeDto[];
  ensureCatalog: () => void;
  retryProperties: () => void;
  retryRoomTypes: () => void;
  problem: SearchProblem | null;
  clearProblem: () => void;
  /**
   * CUST-WEB-001-CP08a: validates the draft and, for a valid one, starts exactly one navigation to the
   * canonical results URL. It asks the server for nothing: the results page reads availability from its URL.
   */
  submit: () => HomeSearchOutcome["kind"];
}

const StaySearchContext = createContext<StaySearchContextValue | null>(null);

/** The shared search, or null outside the provider (the template's own demo forms then keep local state). */
export function useStaySearch(): StaySearchContextValue | null {
  return useContext(StaySearchContext);
}

const RIVERSIDE_SLUG = FEATURED_BRAND_TABS[0].slug as string;

/**
 * The state the home page and every header search share: the search draft and the Riverside catalog
 * (read once, so coming back to the home page does not reload it; the receipt page reads it too).
 *
 * CUST-WEB-001-CP08a: Search no longer asks for offers here. The draft becomes the canonical `/listing-stay`
 * URL (see `lib/homepageSearch`) and the results page, whose URL is the only authority, reads availability.
 * That removes the second quote path, the pending search that could fire when the catalog arrived late, and
 * any price kept in memory from an earlier search.
 */
export function StaySearchProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const pathname = usePathname();

  const [draft, setDraft] = useState<StaySearchDraft>(initialStayDraft);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [problem, setProblem] = useState<SearchProblem | null>(null);
  const attempts = useRef(0);

  const dispatcher = useRef<HomeSearchDispatcher>();
  if (!dispatcher.current) {
    dispatcher.current = createHomeSearchDispatcher({ navigate: (href) => routerRef.current.push(href as never) });
  }

  const [propsStatus, setPropsStatus] = useState<CatalogStatus>("idle");
  const [properties, setProperties] = useState<PropertyDto[]>([]);
  const [propsError, setPropsError] = useState<string | null>(null);
  const propsRequest = useRef<AbortController | null>(null);
  const requested = useRef(false);

  const [roomsStatus, setRoomsStatus] = useState<CatalogStatus>("idle");
  const [roomTypes, setRoomTypes] = useState<RoomTypeDto[]>([]);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const roomsRequest = useRef<AbortController | null>(null);

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
        setPropsError(describeListingError(error, "catalog").message);
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
        setRoomsError(describeListingError(error, "catalog").message);
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

  const submit = useCallback(() => {
    const outcome = (dispatcher.current as HomeSearchDispatcher).run(draftRef.current);
    if (outcome.kind === "invalid") {
      attempts.current += 1;
      setProblem({ id: attempts.current, message: outcome.message });
    } else if (outcome.kind === "navigate") {
      setProblem(null);
    }
    return outcome.kind;
  }, []);

  useEffect(
    () => () => {
      propsRequest.current?.abort();
      roomsRequest.current?.abort();
    },
    []
  );

  const updateDraft = useCallback((patch: Partial<StaySearchDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setProblem(null);
  }, []);

  const clearProblem = useCallback(() => setProblem(null), []);

  // A message about a search that did not start belongs to the page it was made on: leaving that page
  // (a room card, the logo, Back) must not bring it back, with focus, when a form is mounted again.
  useEffect(() => {
    setProblem(null);
  }, [pathname]);

  const value = useMemo<StaySearchContextValue>(
    () => ({
      draft,
      updateDraft,
      propsStatus,
      propsError,
      riverside,
      roomsStatus,
      roomsError,
      roomTypes,
      ensureCatalog,
      retryProperties,
      retryRoomTypes,
      problem,
      clearProblem,
      submit,
    }),
    [draft, updateDraft, propsStatus, propsError, riverside, roomsStatus, roomsError, roomTypes, ensureCatalog, retryProperties, retryRoomTypes, problem, clearProblem, submit]
  );

  return <StaySearchContext.Provider value={value}>{children}</StaySearchContext.Provider>;
}
