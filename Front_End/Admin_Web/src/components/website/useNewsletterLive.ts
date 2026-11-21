"use client";

/**
 * BHA-NEWSLETTER-LIVE-001, moved to the shared activity hint by BHA-ADMIN-BADGE-001-PR14: the Newsletter screen's live connection as a hook. It owns ONE connection to the shared activity Hub (one per
 * mounted screen and Staff identity, closed on unmount, on sign-out and on an account change) and listens only to the hints for the `newsletter` menu. A hint says "something about the subscriptions
 * changed" and nothing else: no id to de-duplicate on, no count, no actor. Hints that arrive close together are gathered into ONE call of `onNew` (the number of hints, never a count of
 * subscriptions), so a burst is one notice and one read. It never reads the list itself: the screen decides when it is safe.
 *
 * A 401 on the connection is the session ending and a 403 the permission going: both go to the gate the way a 401/403 from any read does. A network failure only retries.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MENU_ACTIVITY_EVENT, MENU_ACTIVITY_READY_EVENT, isMenuActivityHint, menuActivityLiveTarget } from "@/lib/api/menuUnseen";
import { startNewsletterLive, type LiveController, type LiveStatus, type LiveStopReason } from "@/lib/website/newsletterLive";
import { useWebsiteHost } from "./WebsiteAccessGate";

/** Signals that arrive within this window are one event for the screen. */
export const LIVE_COALESCE_MS = 300;

/** The one menu this screen listens for on the shared Hub. */
export const NEWSLETTER_MENU = "newsletter";

export interface LiveCallbacks {
  /** The server has registered the connection (first start and every reconnect): read the list again, without announcing anything. */
  onReady: () => void;
  /** `count` hints about the subscriptions that this screen has not been told about yet. The number only sizes a burst; it is not a count of subscriptions. */
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
    let gathered = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    setStatus("connecting");
    setStoppedFor(undefined);

    const controller = startNewsletterLive({
      target: menuActivityLiveTarget(),
      events: { signal: MENU_ACTIVITY_EVENT, ready: MENU_ACTIVITY_READY_EVENT, isSignal: isMenuActivityHint },
      handlers: {
        onReady: () => {
          if (!closed) callbacksRef.current.onReady();
        },
        onSignal: (signal) => {
          if (closed || signal.menuKey !== NEWSLETTER_MENU) return;
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
