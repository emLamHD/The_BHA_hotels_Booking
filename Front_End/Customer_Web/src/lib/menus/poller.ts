import type { MenuSnapshot } from "./menu";

/**
 * CUST-WEB-HEADER-001-CP04: the freshness loop of the header menu, without React so it can be tested: one loop, one request
 * at a time, nothing while the tab is hidden, an immediate check when it is asked for (focus, visibility, navigation), and
 * an abort of the request in flight when it stops. A failed check keeps the menu already on screen and only says it is stale.
 */
/** Between two checks while the tab is visible. Small on purpose: the Admin promises a Save shows on an open tab within 15 seconds, request time included. */
export const MENU_POLL_MS = 10_000;

/** A check asked for by an event (focus, becoming visible, a navigation) is dropped when one started less than this long ago: the events often arrive together. */
export const MENU_MIN_GAP_MS = 1_000;

export interface MenuPollerDeps<T = MenuSnapshot> {
  /** One request for the current language; rejects on a network or HTTP failure, resolves `null` for a body that is not a menu. */
  fetchMenu: (signal: AbortSignal) => Promise<T | null>;
  isVisible: () => boolean;
  onMenu: (menu: T) => void;
  onStale: (stale: boolean) => void;
  intervalMs: number;
}

export interface MenuPoller {
  start: () => void;
  stop: () => void;
  /** Check now (unless hidden, stopped or a check is already running). */
  checkNow: () => void;
}

/** CUST-WEB-HERO-001-CP01: generic over the snapshot, so the home hero uses this same loop (one request at a time, none while hidden). */
export function createMenuPoller<T = MenuSnapshot>(deps: MenuPollerDeps<T>): MenuPoller {
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | null = null;
  let lastStart = Number.NEGATIVE_INFINITY;

  const check = async () => {
    if (stopped || inFlight || !deps.isVisible()) return;
    const controller = new AbortController();
    inFlight = controller;
    lastStart = Date.now();
    try {
      const menu = await deps.fetchMenu(controller.signal);
      if (!menu) throw new Error("not a menu");
      if (!stopped && !controller.signal.aborted) {
        deps.onMenu(menu);
        deps.onStale(false);
      }
    } catch {
      if (!stopped && !controller.signal.aborted) deps.onStale(true);
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  };

  const loop = () => {
    timer = setTimeout(async () => {
      await check();
      if (!stopped) loop();
    }, deps.intervalMs);
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      loop();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      inFlight?.abort();
      inFlight = null;
    },
    checkNow() {
      if (Date.now() - lastStart >= MENU_MIN_GAP_MS) void check();
    },
  };
}
