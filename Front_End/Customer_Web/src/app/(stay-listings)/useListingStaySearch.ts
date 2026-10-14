"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createListingController, ListingState } from "@/lib/stayListingSearch";
import { StayListingQuery, stayListingKey } from "@/lib/stayListingQuery";

/**
 * CUST-WEB-001-CP05a: glue only. The controller (lib/stayListingSearch) owns every rule; this hook gives
 * one page instance its own controller, applies the URL's query whenever its key changes, and aborts
 * everything when the page goes away. It is independent of the home StaySearchProvider.
 */
export function useListingStaySearch(query: StayListingQuery): { state: ListingState; retry: () => void } {
  const [controller] = useState(() => createListingController());
  const key = stayListingKey(query);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    controller.setQuery(queryRef.current);
  }, [controller, key]);

  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return { state, retry: controller.retry };
}
