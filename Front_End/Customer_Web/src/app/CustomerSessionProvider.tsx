"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getCustomerSession } from "@/lib/api/authService";
import { invalidateCsrfToken } from "@/lib/api/csrf";
import {
  CustomerSessionState,
  LOADING_SESSION,
  createCustomerSessionController,
} from "@/lib/customerSession";

export interface CustomerSessionApi {
  /** loading / anonymous / authenticated / unknown, read from `GET /api/v1/auth/me`. */
  state: CustomerSessionState;
  /** Reads the session again (clears the published identity first). It changes nothing server-side. */
  refreshSession: () => void;
}

const CustomerSessionContext = createContext<CustomerSessionApi | null>(null);

/**
 * CUST-WEB-001-CP01a: the read-only Customer session. Mounted once in the root layout, outside the
 * booking providers. It reads `me` on mount and exposes the result; it has no login, register or logout
 * and no UI uses it yet. State lives in this instance only (nothing module-scoped, nothing stored), so
 * two instances or two server requests never share an account. The logic lives in the React-free
 * `createCustomerSessionController`; this component only wires it to React.
 */
export function CustomerSessionProvider({ children }: { children: React.ReactNode }) {
  const [controller] = useState(() =>
    createCustomerSessionController({ readSession: getCustomerSession, invalidateCsrf: invalidateCsrfToken })
  );

  const state = useSyncExternalStore(controller.subscribe, controller.getState, () => LOADING_SESSION);

  // start/stop (not just mount/unmount) so React StrictMode's cleanup-and-remount works: the first read
  // is aborted and the second one is the only one that can publish.
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  const api = useMemo<CustomerSessionApi>(
    () => ({ state, refreshSession: controller.refresh }),
    [state, controller]
  );

  return <CustomerSessionContext.Provider value={api}>{children}</CustomerSessionContext.Provider>;
}

export function useCustomerSession(): CustomerSessionApi {
  const ctx = useContext(CustomerSessionContext);
  if (!ctx) {
    throw new Error("useCustomerSession must be used within a CustomerSessionProvider.");
  }
  return ctx;
}
