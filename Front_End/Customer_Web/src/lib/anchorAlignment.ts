/**
 * CUST-WEB-SHOWCASE-001-CP01-C3: the lifecycle that keeps a section the
 * visitor jumped to (`#booking`, …) in view while content above it settles,
 * for browsers without native scroll anchoring (Safari).
 *
 * One rule decides everything: an *alignment session* starts only from an
 * explicit navigation intent and ends on the first of
 *   - a visitor takeover (wheel, touch, key, mouse),
 *   - the deadline (`windowMs` after the intent that started it),
 *   - a newer intent (a new session replaces it) or a hash that is not a section,
 *   - `dispose()`.
 * Nothing else starts or extends a session. In particular data arriving,
 * layout changing or a catalog becoming ready is not an intent, so a session
 * the visitor cancelled is never revived by content that loads later.
 *
 * Intents: the controller being created (the hash already present at mount),
 * `hashchange`, and `navigationEvent` (a same-fragment click, which browsers do
 * not report as `hashchange`).
 *
 * The browser pieces are injected so the same code runs under Vitest with fakes.
 */

export interface AlignmentTarget {
  scrollIntoView(options: { block: "start" }): void;
}

export interface AlignmentObserver<T> {
  observe(element: T): void;
  disconnect(): void;
}

/** `T` is the element type: `HTMLElement` in the browser, a stand-in in tests. */
export interface AlignmentEnvironment<T extends AlignmentTarget> {
  /** `window` or a stand-in: needs `location.hash` and event listeners. */
  window: {
    location: { hash: string };
    addEventListener(type: string, listener: () => void, options?: { passive: boolean }): void;
    removeEventListener(type: string, listener: () => void): void;
  };
  getElementById(id: string): T | null;
  createObserver(onResize: () => void): AlignmentObserver<T>;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AnchorAlignmentOptions<T extends AlignmentTarget> {
  container: T & { contains(node: T | null): boolean };
  sections: ReadonlySet<string>;
  navigationEvent: string;
  takeoverEvents: readonly string[];
  windowMs: number;
  environment: AlignmentEnvironment<T>;
}

export interface AnchorAlignment {
  dispose(): void;
}

export function createAnchorAlignment<T extends AlignmentTarget>(options: AnchorAlignmentOptions<T>): AnchorAlignment {
  const { container, sections, navigationEvent, takeoverEvents, windowMs, environment } = options;
  const win = environment.window;

  let disposed = false;
  let session = 0; // identity of the active session; 0 means none
  let observer: AlignmentObserver<T> | null = null;
  let deadline: unknown;

  function stop() {
    session = 0;
    observer?.disconnect();
    observer = null;
    if (deadline !== undefined) environment.clearTimeout(deadline);
    deadline = undefined;
    takeoverEvents.forEach((type) => win.removeEventListener(type, stop));
  }

  let counter = 0;
  function start() {
    stop(); // at most one session, one observer, one set of takeover listeners

    const section = win.location.hash.slice(1);
    if (disposed || !sections.has(section)) return;
    const target = environment.getElementById(section);
    if (!target || !container.contains(target)) return;

    const mine = ++counter;
    session = mine;
    // A queued callback from a session that has since ended must do nothing:
    // it checks the session it belongs to, and that the visitor still means it.
    const align = () => {
      if (session !== mine || win.location.hash.slice(1) !== section) return;
      if (environment.getElementById(section) !== target) return;
      target.scrollIntoView({ block: "start" });
    };

    observer = environment.createObserver(align);
    observer.observe(container);
    observer.observe(target);
    deadline = environment.setTimeout(() => {
      if (session === mine) stop();
    }, windowMs);
    takeoverEvents.forEach((type) => win.addEventListener(type, stop, { passive: true }));
    align();
  }

  win.addEventListener("hashchange", start);
  win.addEventListener(navigationEvent, start);
  start(); // the hash already present when the section mounts

  return {
    dispose() {
      disposed = true;
      stop();
      win.removeEventListener("hashchange", start);
      win.removeEventListener(navigationEvent, start);
    },
  };
}
