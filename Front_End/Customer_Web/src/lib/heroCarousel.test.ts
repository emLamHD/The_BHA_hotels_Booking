import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoplayInputs, nextIndex, prevIndex, resolveActive, scheduleAutoplay, shouldAutoplay } from "./heroCarousel";

const calm: AutoplayInputs = {
  adminEnabled: true,
  slideCount: 4,
  reducedMotion: false,
  hovered: false,
  focusWithin: false,
  documentHidden: false,
  dragging: false,
  pausedByVisitor: false,
};

describe("hero autoplay", () => {
  it("runs for an undisturbed visitor", () => {
    expect(shouldAutoplay(calm)).toBe(true);
  });

  it.each([
    ["reduced motion", { reducedMotion: true }],
    ["the pointer on it", { hovered: true }],
    ["keyboard focus inside", { focusWithin: true }],
    ["a hidden tab", { documentHidden: true }],
    ["a swipe in progress", { dragging: true }],
    ["the visitor's pause", { pausedByVisitor: true }],
    ["the Admin having switched it off", { adminEnabled: false }],
    ["a single slide", { slideCount: 1 }],
    ["no slide", { slideCount: 0 }],
  ])("does not run with %s", (_name, patch) => {
    expect(shouldAutoplay({ ...calm, ...patch })).toBe(false);
  });

  it("moves round in both directions without leaving the range", () => {
    expect(nextIndex(0, 4)).toBe(1);
    expect(nextIndex(3, 4)).toBe(0);
    expect(prevIndex(0, 4)).toBe(3);
    expect(prevIndex(2, 4)).toBe(1);
    expect(nextIndex(0, 0)).toBe(0);
    expect(prevIndex(0, 0)).toBe(0);
  });
});

describe("the slide on screen is held by its id", () => {
  const ids = ["a", "b", "c", "d"];

  it("follows its slide when the order changes", () => {
    expect(resolveActive(ids, "c", 2)).toEqual({ index: 2, id: "c" });
    expect(resolveActive(["c", "a", "b", "d"], "c", 2)).toEqual({ index: 0, id: "c" });
  });

  it("lands on the slide that took its place when it is deleted, or on the last one — never past the end", () => {
    expect(resolveActive(["a", "b", "d"], "c", 2)).toEqual({ index: 2, id: "d" });
    expect(resolveActive(["a", "b"], "d", 3)).toEqual({ index: 1, id: "b" });
    expect(resolveActive(["a"], "b", 1)).toEqual({ index: 0, id: "a" });
  });

  it("starts on the first slide, and has none when there is none", () => {
    expect(resolveActive(ids, null, 0)).toEqual({ index: 0, id: "a" });
    expect(resolveActive([], "a", 3)).toEqual({ index: 0, id: null });
    expect(resolveActive(ids, null, -4).index).toBe(0);
  });
});

describe("the autoplay timer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after the interval, and re-arming with another interval fires at the new one only", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const stop = scheduleAutoplay(true, 6000, advance);
    vi.advanceTimersByTime(5999);
    expect(advance).not.toHaveBeenCalled();
    stop();                                                    // the effect cleanup before the next arm
    expect(vi.getTimerCount()).toBe(0);
    scheduleAutoplay(true, 3000, advance);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3000);
    expect(advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(advance).toHaveBeenCalledTimes(1);                  // one-shot: the next slide arms the next timer
  });

  it("is cleared by its cleanup and never moves after it", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    scheduleAutoplay(true, 6000, advance)();
    vi.advanceTimersByTime(120_000);
    expect(advance).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("arms nothing when autoplay may not run or the interval is not usable", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    for (const [enabled, ms] of [[false, 6000], [true, 0], [true, -1], [true, Number.NaN]] as const) scheduleAutoplay(enabled, ms, advance);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(advance).not.toHaveBeenCalled();
  });
});
