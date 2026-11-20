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

/** What a 401 and a 403 on the connection do: the website gate's host handlers, or the shared session's (BHA-NEWSLETTER-BADGE-001). */
export interface LiveAuthHandlers {
  onUnauthenticated: () => void;
  onDenied: () => Promise<void> | void;
}

/** The connection of ONE owner. `enabled: false` keeps it from starting at all (the screen then uses the shared connection). */
export function useNewsletterLiveConnection(identity: string, callbacks: LiveCallbacks, auth: LiveAuthHandlers, enabled = true) {
  const hostRef = useRef(auth);
  hostRef.current = auth;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [stoppedFor, setStoppedFor] = useState<LiveStopReason | undefined>(undefined);
  const controllerRef = useRef<LiveController | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
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
  }, [identity, enabled]);

  const retry = useCallback(() => controllerRef.current?.retryNow(), []);
  return { status, stoppedFor, retry };
}

/** The screen's own connection (the website gate's handlers). Used when no shared connection exists (the screen rendered on its own); see `NewsletterBadgeProvider`. */
export function useNewsletterLive(identity: string, callbacks: LiveCallbacks, enabled = true) {
  const host = useWebsiteHost();
  return useNewsletterLiveConnection(identity, callbacks, host, enabled);
}
