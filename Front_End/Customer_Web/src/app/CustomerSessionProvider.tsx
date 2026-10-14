"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getCustomerSession, loginCustomer, logoutCustomer } from "@/lib/api/authService";
import { invalidateCsrfToken } from "@/lib/api/csrf";
import type { BookingIdentityGuard } from "@/lib/api/bookingHoldFlowController";
import type { CustomerCredentials } from "@/lib/api/authService";
import {
  IdentityChangeState,
  IdentityCommandResult,
  createCustomerIdentityCoordinator,
} from "@/lib/customerIdentityChange";
import {
  CustomerSessionState,
  LOADING_SESSION,
  createCustomerSessionController,
} from "@/lib/customerSession";

export interface CustomerSessionApi {
  /** loading / anonymous / authenticated / unknown, read from `GET /api/v1/auth/me`. */
  state: CustomerSessionState;
  /** idle, or which part of a guarded identity change is under way (the booking flow is locked meanwhile). */
  identityChange: IdentityChangeState;
  /**
   * Reads the session again. While a guarded login/logout (or its recovery read) is running this does not
   * read early: it joins that read; after a failed recovery read it retries it. Changes nothing server-side.
   */
  refreshSession: () => void;
  /**
   * The only way for UI to change the Customer identity. Refused, with no request and no state change,
   * while a booking is in progress, a receipt is not finished, or another identity change is running.
   * Resolves once `me` has been read again (see `IdentityCommandResult`). Never import `loginCustomer`
   * from the transport to get around this.
   */
  guardedLogin: (credentials: CustomerCredentials) => Promise<IdentityCommandResult>;
  guardedLogout: () => Promise<IdentityCommandResult>;
}

/** What the booking provider needs from the identity coordinator. Not for UI. */
export interface CustomerIdentityBinding {
  isIdentityChangeLocked: () => boolean;
  bindBooking: (guard: BookingIdentityGuard) => () => void;
}

const CustomerSessionContext = createContext<CustomerSessionApi | null>(null);
const CustomerIdentityBindingContext = createContext<CustomerIdentityBinding | null>(null);

/**
 * CUST-WEB-001-CP01a/CP01b: the Customer session. Mounted once in the root layout, outside the booking
 * providers. It reads `me` on mount, and offers guarded login/logout that are serialized with the booking
 * flow by one coordinator per instance (nothing module-scoped, nothing stored). The login page and the header/app-bar account entries (CP02) use it. The
 * logic lives in the React-free controllers; this component only wires them to React.
 */
export function CustomerSessionProvider({ children }: { children: React.ReactNode }) {
  const [{ controller, coordinator }] = useState(() => {
    const controller = createCustomerSessionController({
      readSession: getCustomerSession,
      invalidateCsrf: invalidateCsrfToken,
    });
    const coordinator = createCustomerIdentityCoordinator({
      session: controller,
      login: loginCustomer,
      logout: logoutCustomer,
    });
    return { controller, coordinator };
  });

  const state = useSyncExternalStore(controller.subscribe, controller.getState, () => LOADING_SESSION);
  const identityChange = useSyncExternalStore(coordinator.subscribe, coordinator.getState, () => IDLE_IDENTITY);

  // start/stop (not just mount/unmount) so React StrictMode's cleanup-and-remount works: the first read is
  // aborted and the second one is the only one that can publish.
  useEffect(() => {
    coordinator.activate();
    controller.start();
    return () => {
      controller.stop();
      coordinator.deactivate();
    };
  }, [controller, coordinator]);

  const api = useMemo<CustomerSessionApi>(
    () => ({
      state,
      identityChange,
      refreshSession: coordinator.requestRefresh,
      guardedLogin: coordinator.login,
      guardedLogout: coordinator.logout,
    }),
    [state, identityChange, coordinator]
  );
  const binding = useMemo<CustomerIdentityBinding>(
    () => ({ isIdentityChangeLocked: coordinator.isIdentityChangeLocked, bindBooking: coordinator.bindBooking }),
    [coordinator]
  );

  return (
    <CustomerIdentityBindingContext.Provider value={binding}>
      <CustomerSessionContext.Provider value={api}>{children}</CustomerSessionContext.Provider>
    </CustomerIdentityBindingContext.Provider>
  );
}

const IDLE_IDENTITY: IdentityChangeState = { phase: "idle" };

export function useCustomerSession(): CustomerSessionApi {
  const ctx = useContext(CustomerSessionContext);
  if (!ctx) {
    throw new Error("useCustomerSession must be used within a CustomerSessionProvider.");
  }
  return ctx;
}

/** For the booking provider only: null outside a CustomerSessionProvider (no identity coordination then). */
export function useCustomerIdentityBinding(): CustomerIdentityBinding | null {
  return useContext(CustomerIdentityBindingContext);
}
