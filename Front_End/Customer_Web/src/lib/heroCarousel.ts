/**
 * CUST-WEB-001-CP08a-C2: the decisions of the home page's hero slideshow, free of the browser so they can be
 * tested. Autoplay is a convenience that yields to everything else: it never runs for a visitor who asked for
 * reduced motion, while the pointer or keyboard focus is on the slideshow, while the tab is hidden, while a
 * swipe is in progress, or after the visitor paused it. It only changes the picture; it never navigates,
 * submits or touches the search draft. The Admin chooses whether it runs at all and how many seconds a slide stays
 * (`lib/hero`); this file only decides, from the visitor's situation, whether it may.
 */

export interface AutoplayInputs {
  /** CUST-WEB-HERO-001-CP01: the Admin's switch for the whole slideshow; the visitor's own controls can only pause further, never override it. */
  adminEnabled: boolean;
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
    inputs.adminEnabled &&
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

/**
 * The slide on screen is held by its id, so reordering the slides moves the picture's position but never changes the picture, and a
 * deleted slide never leaves an index past the end. `lastIndex` is where the visitor was: when their slide is gone they land on the one
 * that took its place (or the last), never on a black frame. An empty list has no active slide.
 */
export function resolveActive(ids: readonly string[], activeId: string | null, lastIndex: number): { index: number; id: string | null } {
  if (ids.length === 0) return { index: 0, id: null };
  const at = activeId === null ? -1 : ids.indexOf(activeId);
  if (at >= 0) return { index: at, id: ids[at] };
  const index = Math.min(Math.max(lastIndex, 0), ids.length - 1);
  return { index, id: ids[index] };
}

/**
 * Arms the one timer that moves to the next slide, and returns the function that clears it. Nothing is armed when autoplay may not run
 * or the interval is not a positive number; the component calls this from one effect keyed on the slide, the interval, the Admin's
 * switch and the visitor's situation, so every change clears the old timer before arming the new one and at most one exists.
 */
export function scheduleAutoplay(enabled: boolean, intervalMs: number, advance: () => void): () => void {
  if (!enabled || !(intervalMs > 0)) return () => undefined;
  const timer = setTimeout(advance, intervalMs);
  return () => clearTimeout(timer);
}
