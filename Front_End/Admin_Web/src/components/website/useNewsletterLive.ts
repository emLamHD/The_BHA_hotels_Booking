"use client";

/**
 * BHA-NEWSLETTER-LIVE-001: the Newsletter screen's live connection as a hook. It owns the connection (one per mounted screen and Staff identity, closed on unmount, on
 * sign-out and on an account change), drops a signal it has already handled (same `eventId`, also after a reconnect) and gathers signals that arrive close together into
 * ONE call of `onNew`, so a burst is one toast and one read, never a request per signal. It never reads the list itself: the screen decides when it is safe.
 *
 * A 401 on the connection is the session ending and a 403 the permission going: both go to the gate the way a 401/403 from any read does. A network failure only retries.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { newsletterLiveTarget } from "@/lib/api/website";
import { startNewsletterLive, type LiveController, type LiveStatus, type LiveStopReason } from "@/lib/website/newsletterLive";
import { useWebsiteHost } from "./WebsiteAccessGate";

/** Signals that arrive within this window are one event for the screen. */
export const LIVE_COALESCE_MS = 300;
const REMEMBERED_EVENTS = 200;

export interface LiveCallbacks {
  /** The server has registered the connection (first start and every reconnect): read the list again, without announcing anything. */
  onReady: () => void;
  /** `count` verifications this screen has not been told about yet. */
  onNew: (count: number) => void;
}

export function useNewsletterLive(identity: string, callbacks: LiveCallbacks) {
  const host = useWebsiteHost();
  const hostRef = useRef(host);
  hostRef.current = host;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [stoppedFor, setStoppedFor] = useState<LiveStopReason | undefined>(undefined);
  const controllerRef = useRef<LiveController | null>(null);

  useEffect(() => {
    const seen = new Set<string>();
    let gathered = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    setStatus("connecting");
    setStoppedFor(undefined);

    const controller = startNewsletterLive({
      target: newsletterLiveTarget(),
      handlers: {
        onReady: () => {
          if (!closed) callbacksRef.current.onReady();
        },
        onSignal: (signal) => {
          if (closed || seen.has(signal.eventId)) return;
          seen.add(signal.eventId);
          if (seen.size > REMEMBERED_EVENTS) seen.delete(seen.values().next().value as string);
          gathered += 1;
          timer ??= setTimeout(() => {
            timer = null;
            const count = gathered;
            gathered = 0;
            if (!closed && count > 0) callbacksRef.current.onNew(count);
          }, LIVE_COALESCE_MS);
        },
        onStatus: (next, reason) => {
          if (closed) return;
          setStatus(next);
          setStoppedFor(next === "stopped" ? reason : undefined);
        },
        onUnauthenticated: () => {
          if (!closed) hostRef.current.onUnauthenticated();
        },
        onDenied: () => {
          if (!closed) void hostRef.current.onDenied();
        },
      },
    });
    controllerRef.current = controller;

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [identity]);

  const retry = useCallback(() => controllerRef.current?.retryNow(), []);
  return { status, stoppedFor, retry };
}
