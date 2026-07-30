"use client";

import React, { createContext, useContext, useEffect, useReducer, useRef } from "react";
import {
  BookingHoldFlowState,
  bookingHoldFlowReducer,
  initialBookingHoldFlowState,
} from "@/lib/api/bookingHoldFlow";
import {
  BookingHoldFlowController,
  createBookingHoldFlowController,
} from "@/lib/api/bookingHoldFlowController";

export interface BookingHoldFlowApi extends BookingHoldFlowController {
  state: BookingHoldFlowState;
}

const BookingHoldFlowContext = createContext<BookingHoldFlowApi | null>(null);

/**
 * Owns the authoritative Booking Hold flow for the lifetime of the mounted
 * browser app (mounted once in the root layout, so it survives normal
 * Next.js client navigation — only a hard reload/tab close loses it, which
 * remains an explicit FE-001.4 limitation). Per-instance `useReducer`/`useRef`
 * state, not a module-scoped singleton, so nothing leaks across SSR
 * requests or users.
 *
 * The actual guard/coordination logic lives in the React-free
 * `createBookingHoldFlowController` — this component only wires it to
 * `useReducer` and keeps a ref-backed `getState` so the controller's
 * synchronous checks always see the latest state, never a stale closure.
 */
export function BookingHoldProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(bookingHoldFlowReducer, initialBookingHoldFlowState);

  const stateRef = useRef(state);
  stateRef.current = state;

  // Owned at the app level: BookingHoldPanel/SectionAvailabilitySearch
  // unmounting (e.g. client navigation away from /home-2) must never abort
  // this. Only this provider's own teardown (effectively whole-app
  // unmount) may abort it.
  const abortControllerRef = useRef<AbortController | null>(null);

  const controllerRef = useRef<BookingHoldFlowController>();
  if (!controllerRef.current) {
    controllerRef.current = createBookingHoldFlowController({
      getState: () => stateRef.current,
      dispatch,
      onAttemptStart: (controller) => {
        abortControllerRef.current = controller;
      },
    });
  }

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const api: BookingHoldFlowApi = { state, ...controllerRef.current };

  return <BookingHoldFlowContext.Provider value={api}>{children}</BookingHoldFlowContext.Provider>;
}

export function useBookingHoldFlow(): BookingHoldFlowApi {
  const ctx = useContext(BookingHoldFlowContext);
  if (!ctx) {
    throw new Error("useBookingHoldFlow must be used within a BookingHoldProvider.");
  }
  return ctx;
}
