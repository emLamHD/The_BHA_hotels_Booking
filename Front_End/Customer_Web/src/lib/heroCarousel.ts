/**
 * CUST-WEB-001-CP08a-C2: the decisions of the home page's hero slideshow, free of the browser so they can be
 * tested. Autoplay is a convenience that yields to everything else: it never runs for a visitor who asked for
 * reduced motion, while the pointer or keyboard focus is on the slideshow, while the tab is hidden, while a
 * swipe is in progress, or after the visitor paused it. It only changes the picture; it never navigates,
 * submits or touches the search draft.
 */

export const AUTOPLAY_INTERVAL_MS = 6000;

export interface AutoplayInputs {
  slideCount: number;
  reducedMotion: boolean;
  hovered: boolean;
  focusWithin: boolean;
  documentHidden: boolean;
  dragging: boolean;
  pausedByVisitor: boolean;
}

export function shouldAutoplay(inputs: AutoplayInputs): boolean {
  return (
    inputs.slideCount > 1 &&
    !inputs.reducedMotion &&
    !inputs.hovered &&
    !inputs.focusWithin &&
    !inputs.documentHidden &&
    !inputs.dragging &&
    !inputs.pausedByVisitor
  );
}

export function nextIndex(index: number, count: number): number {
  return count <= 0 ? 0 : (index + 1) % count;
}

export function prevIndex(index: number, count: number): number {
  return count <= 0 ? 0 : (index - 1 + count) % count;
}

/** A slide is reachable by keyboard and screen reader only while it is the one showing. */
export const isSlideActive = (slide: number, current: number) => slide === current;
