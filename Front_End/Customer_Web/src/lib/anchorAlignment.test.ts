import { describe, expect, it } from "vitest";
import { createAnchorAlignment, type AlignmentObserver } from "./anchorAlignment";

/**
 * CUST-WEB-SHOWCASE-001-CP01-C3: the lifecycle that keeps `#booking` & co in
 * view while content settles. These tests drive the same controller the page
 * component creates (SectionGridFeatureProperty), with a fake window, observer
 * and clock. Wiring the controller to React (one effect, no dependencies) is
 * covered by the browser run recorded in the completion report: Vitest here
 * runs in node and cannot execute effects.
 */

const WINDOW_MS = 5000;
const SECTIONS = new Set(["catalog", "room-types", "booking"]);
const TAKEOVER = ["wheel", "touchstart", "keydown", "mousedown"] as const;
const NAVIGATION = "showcase:section-navigation";

class FakeElement {
  scrolls = 0;
  readonly inside = new Set<FakeElement>();
  scrollIntoView() {
    this.scrolls += 1;
  }
  contains(node: FakeElement | null) {
    return node === this || (node !== null && this.inside.has(node));
  }
}

class FakeWindow {
  readonly location = { hash: "" };
  private readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string) {
    Array.from(this.listeners.get(type) ?? []).forEach((listener) => listener());
  }
  navigate(hash: string) {
    this.location.hash = hash;
    this.dispatch("hashchange");
  }
  get listenerCount() {
    return Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0);
  }
}

class FakeObserver implements AlignmentObserver<FakeElement> {
  disconnected = false;
  readonly observed: FakeElement[] = [];
  constructor(readonly onResize: () => void) {}
  observe(element: FakeElement) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
}

function setup(initialHash = "") {
  const win = new FakeWindow();
  win.location.hash = initialHash;
  const container = new FakeElement(); // #catalog
  const booking = new FakeElement();
  const roomTypes = new FakeElement();
  const outside = new FakeElement();
  container.inside.add(booking).add(roomTypes);
  const elements: Record<string, FakeElement> = { catalog: container, booking, "room-types": roomTypes, outside };

  const observers: FakeObserver[] = [];
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();

  const alignment = createAnchorAlignment<FakeElement>({
    container,
    sections: SECTIONS,
    navigationEvent: NAVIGATION,
    takeoverEvents: TAKEOVER,
    windowMs: WINDOW_MS,
    environment: {
      window: win,
      getElementById: (id) => elements[id] ?? null,
      createObserver: (onResize) => {
        const observer = new FakeObserver(onResize);
        observers.push(observer);
        return observer;
      },
      setTimeout: (callback, ms) => {
        const id = nextTimer++;
        timers.set(id, { at: now + ms, callback });
        return id;
      },
      clearTimeout: (handle) => void timers.delete(handle as number),
    },
  });

  return {
    win, container, booking, roomTypes, outside, observers, alignment, elements,
    get active() { return observers.filter((observer) => !observer.disconnected); },
    get pendingTimers() { return timers.size; },
    advance(ms: number) {
      now += ms;
      Array.from(timers.entries()).filter(([, timer]) => timer.at <= now).forEach(([id, timer]) => { timers.delete(id); timer.callback(); });
    },
  };
}

describe("alignment session start", () => {
  it("aligns to the hashed section when created and again as layout settles inside the window", () => {
    const t = setup("#booking");
    expect(t.booking.scrolls).toBe(1);
    expect(t.active).toHaveLength(1);
    expect(t.active[0].observed).toEqual([t.container, t.booking]);

    t.advance(2000);
    t.active[0].onResize(); // catalog / RoomTypes arrive without the visitor touching anything
    expect(t.booking.scrolls).toBe(2);
  });

  it("starts nothing without a section hash, then starts on a navigation", () => {
    const t = setup("");
    expect(t.observers).toHaveLength(0);
    expect(t.pendingTimers).toBe(0);
    t.win.navigate("#room-types");
    expect(t.roomTypes.scrolls).toBe(1);
    expect(t.active).toHaveLength(1);
  });

  it.each(["#nope", "#outside"])("ignores %s (unknown section, or a target outside the container)", (hash) => {
    const t = setup(hash);
    expect(t.observers).toHaveLength(0);
    expect(t.win.listenerCount).toBe(2); // only the two intent listeners
  });
});

describe("visitor takeover", () => {
  it.each(TAKEOVER)("%s ends alignment, and content loading afterwards cannot revive it (the C2 defect)", (type) => {
    const t = setup("#booking");
    expect(t.booking.scrolls).toBe(1);

    t.win.dispatch(type); // the visitor scrolls / taps / types away

    expect(t.active).toHaveLength(0);
    expect(t.pendingTimers).toBe(0);
    expect(t.win.listenerCount).toBe(2); // takeover listeners removed

    // The catalog and RoomTypes arrive afterwards: a layout callback already queued
    // on the old observer, and any amount of time, scroll nothing and start nothing.
    t.observers[0].onResize();
    t.advance(WINDOW_MS * 2);
    expect(t.booking.scrolls).toBe(1);
    expect(t.observers).toHaveLength(1);
  });
});

describe("a new explicit intent", () => {
  it("a same-fragment click after a takeover opens a fresh window", () => {
    const t = setup("#booking");
    t.win.dispatch("wheel");
    expect(t.active).toHaveLength(0);

    t.win.dispatch(NAVIGATION); // hash is still #booking
    expect(t.booking.scrolls).toBe(2);
    expect(t.active).toHaveLength(1);
    expect(t.observers).toHaveLength(2);

    t.active[0].onResize();
    expect(t.booking.scrolls).toBe(3);
  });

  it("a hash change opens a window for the new target and the old target is never called again", () => {
    const t = setup("#booking");
    const [first] = t.observers;

    t.win.navigate("#room-types");
    expect(t.roomTypes.scrolls).toBe(1);
    expect(first.disconnected).toBe(true);
    expect(t.active).toHaveLength(1); // never two observers at once

    first.onResize(); // a callback queued for the old target
    expect(t.booking.scrolls).toBe(1);

    t.active[0].onResize();
    expect(t.roomTypes.scrolls).toBe(2);
    expect(t.booking.scrolls).toBe(1);
  });

  it("changing the target after a takeover opens a window for the new target only", () => {
    const t = setup("#booking");
    t.win.dispatch("touchstart");
    t.win.navigate("#catalog");
    expect(t.container.scrolls).toBe(1);
    expect(t.booking.scrolls).toBe(1);
    t.observers[0].onResize();
    expect(t.booking.scrolls).toBe(1);
  });

  it("a hash that is no longer a section ends alignment", () => {
    const t = setup("#booking");
    t.win.navigate("");
    expect(t.active).toHaveLength(0);
    expect(t.pendingTimers).toBe(0);
    t.observers[0].onResize();
    expect(t.booking.scrolls).toBe(1);
    t.win.navigate("#nope");
    expect(t.active).toHaveLength(0);
  });

  it("a callback queued for a target the hash no longer names does nothing", () => {
    const t = setup("#booking");
    t.win.location.hash = "#room-types"; // changed without hashchange having been handled yet
    t.observers[0].onResize();
    expect(t.booking.scrolls).toBe(1);
    expect(t.roomTypes.scrolls).toBe(0);
  });
});

describe("a target that was replaced", () => {
  it("is not scrolled by a callback queued before the replacement", () => {
    const t = setup("#booking");
    const replaced = t.booking;
    t.elements.booking = new FakeElement(); // React re-created the section's node
    t.observers[0].onResize();
    expect(replaced.scrolls).toBe(1);
    expect(t.elements.booking.scrolls).toBe(0);
  });
});

describe("the deadline", () => {
  it("ends the session after the window and nothing restarts it", () => {
    const t = setup("#booking");
    t.advance(WINDOW_MS - 1);
    t.active[0].onResize();
    expect(t.booking.scrolls).toBe(2); // still inside the window

    t.advance(1);
    expect(t.active).toHaveLength(0);
    expect(t.win.listenerCount).toBe(2);

    t.observers[0].onResize(); // late layout / data
    t.advance(WINDOW_MS * 3);
    expect(t.booking.scrolls).toBe(2);
    expect(t.observers).toHaveLength(1);
  });

  it("is measured from the intent that is active: a newer intent gets a full window and the old timer is gone", () => {
    const t = setup("#booking");
    t.advance(3000);
    t.win.navigate("#room-types");
    expect(t.pendingTimers).toBe(1);

    t.advance(WINDOW_MS - 3000); // the first deadline would have fired here
    expect(t.active).toHaveLength(1);
    t.advance(3000 - 1);
    expect(t.active).toHaveLength(1);
    t.advance(1);
    expect(t.active).toHaveLength(0);
  });
});

describe("dispose", () => {
  it("disconnects the observer, clears the timer and removes every listener; late callbacks do nothing", () => {
    const t = setup("#booking");
    expect(t.win.listenerCount).toBe(2 + TAKEOVER.length);

    t.alignment.dispose();
    expect(t.active).toHaveLength(0);
    expect(t.pendingTimers).toBe(0);
    expect(t.win.listenerCount).toBe(0);

    t.observers[0].onResize();
    t.advance(WINDOW_MS * 2);
    t.win.navigate("#room-types");
    t.win.dispatch(NAVIGATION);
    expect(t.booking.scrolls).toBe(1);
    expect(t.roomTypes.scrolls).toBe(0);
    expect(t.observers).toHaveLength(1);
  });

  it("does not leak observers, timers or listeners across many intents", () => {
    const t = setup("#booking");
    for (let i = 0; i < 25; i += 1) {
      t.win.navigate(i % 2 ? "#room-types" : "#booking");
      t.win.dispatch(NAVIGATION);
    }
    expect(t.active).toHaveLength(1);
    expect(t.pendingTimers).toBe(1);
    expect(t.win.listenerCount).toBe(2 + TAKEOVER.length);
    t.alignment.dispose();
    expect(t.win.listenerCount).toBe(0);
    expect(t.pendingTimers).toBe(0);
    expect(t.active).toHaveLength(0);
  });
});
