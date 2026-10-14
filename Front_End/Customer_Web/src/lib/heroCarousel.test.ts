import { describe, expect, it } from "vitest";
import { AUTOPLAY_INTERVAL_MS, AutoplayInputs, nextIndex, prevIndex, shouldAutoplay } from "./heroCarousel";

const calm: AutoplayInputs = {
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
    expect(AUTOPLAY_INTERVAL_MS).toBeGreaterThanOrEqual(5000);
  });

  it.each([
    ["reduced motion", { reducedMotion: true }],
    ["the pointer on it", { hovered: true }],
    ["keyboard focus inside", { focusWithin: true }],
    ["a hidden tab", { documentHidden: true }],
    ["a swipe in progress", { dragging: true }],
    ["the visitor's pause", { pausedByVisitor: true }],
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
