"use client";

/**
 * CUST-WEB-HEADER-001-CP02: the two small hooks every website screen shares.
 *
 * `useWebsiteList` loads one resource from the server, once per call of `reload`, and drops an answer that belongs
 * to an older load. `useWriteAction` is one write: it claims the host's single write slot synchronously (a double
 * click cannot send twice), sends exactly once, never retries, and sorts the answer — a refusal (400/404/409) keeps
 * the form and says why, a lost answer is `unverified` and blocks sending again until the server has been read.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useWebsiteHost } from "./WebsiteAccessGate";
import type { WebsiteFailure, WebsiteResult } from "@/lib/api/website";

export type ListState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export function describeFailure(failure: WebsiteFailure): string {
  switch (failure.kind) {
    case "refused":
      return failure.detail;
    case "unverified":
    case "network":
    case "error":
    case "invalid-response":
    case "config":
      return failure.message;
    case "denied":
      return "The server refused the request: this account may no longer have access to the website settings.";
    case "unauthenticated":
      return "Your Staff session has ended.";
  }
}

export function useWebsiteList<T>(load: (signal: AbortSignal) => Promise<WebsiteResult<T>>, deps: ReadonlyArray<unknown>) {
  const host = useWebsiteHost();
  const [state, setState] = useState<ListState<T>>({ status: "loading" });
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  // The host's handlers change identity with its state; the load itself must not restart because of that.
  const hostRef = useRef(host);
  hostRef.current = host;

  /** Reads the server again. Resolves with the data it read, or `null` when the read failed or a newer one took over. */
  const reload = useCallback(async (): Promise<T | null> => {
    controller.current?.abort();
    const mine = ++generation.current;
    const next = new AbortController();
    controller.current = next;
    setState((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    const result = await loadRef.current(next.signal);
    if (generation.current !== mine) return null;
    if (result.kind === "ok") {
      setState({ status: "ready", data: result.data });
      return result.data;
    }
    if (result.kind === "unauthenticated") hostRef.current.onUnauthenticated();
    else if (result.kind === "denied") void hostRef.current.onDenied();
    setState({ status: "error", message: describeFailure(result) });
    return null;
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
    // `deps` is the caller's list of what a different load depends on (the locale, the filter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);

  return { state, reload };
}

export type WriteStatus =
  | { phase: "idle" }
  | { phase: "pending" }
  | { phase: "refused"; failure: Extract<WebsiteFailure, { kind: "refused" }> }
  | { phase: "failed"; message: string }
  | { phase: "unverified"; message: string };

/**
 * One write action. `run` returns the result, or `null` when it did not start (another write is on the wire or a
 * sign-out is in progress). A 401/403 is handed to the host; the others are kept as the status for the form.
 */
export function useWriteAction() {
  const host = useWebsiteHost();
  const hostRef = useRef(host);
  hostRef.current = host;
  const [status, setStatus] = useState<WriteStatus>({ phase: "idle" });
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(send: () => Promise<WebsiteResult<T>>): Promise<WebsiteResult<T> | null> => {
    if (startedRef.current || !hostRef.current.beginWrite()) return null;
    startedRef.current = true;
    if (mountedRef.current) setStatus({ phase: "pending" });
    try {
      const result = await send();
      if (mountedRef.current) {
        if (result.kind === "ok") setStatus({ phase: "idle" });
        else if (result.kind === "refused") setStatus({ phase: "refused", failure: result });
        else if (result.kind === "unverified") setStatus({ phase: "unverified", message: result.message });
        else if (result.kind === "unauthenticated" || result.kind === "denied") setStatus({ phase: "failed", message: describeFailure(result) });
        else setStatus({ phase: "failed", message: describeFailure(result) });
      }
      if (result.kind === "unauthenticated") hostRef.current.onUnauthenticated();
      else if (result.kind === "denied") void hostRef.current.onDenied();
      return result;
    } finally {
      startedRef.current = false;
      hostRef.current.endWrite();
    }
  }, []);

  const reset = useCallback(() => setStatus({ phase: "idle" }), []);
  return { status, run, reset, setStatus };
}
