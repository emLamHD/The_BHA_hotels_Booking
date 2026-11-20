import React from "react";

/** The number as shown: 1–99, then `99+`. The label keeps the real number. */
export const unseenText = (count: number) => (count > 99 ? "99+" : String(count));

const PILL = "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-error-500 px-1.5 text-xs font-medium leading-none text-white";

/**
 * BHA-NEWSLETTER-BADGE-001 / BHA-ADMIN-BADGE-001-PR04: the red counter beside a menu entry. Hidden at 0; never a template `new`/`pro` label. `className` places it (the sidebar pins it over
 * the entry, or to the corner of its icon when collapsed). A plain image, not a control: the Calendar's number stays one until its popover exists.
 */
export function UnseenBadge({ count, testId, label, className = "", placement = "inline" }: { count: number; testId: string; label: string; className?: string; placement?: "inline" | "corner" }) {
  if (count <= 0) return null;
  return (
    <span role="img" aria-label={`${count} ${label}`} data-testid={testId} data-placement={placement} className={`${PILL} ${className}`}>
      <span aria-hidden>{unseenText(count)}</span>
    </span>
  );
}

/**
 * BHA-ADMIN-BADGE-001-PR05: the same counter as a button of its own that opens the unseen list. It is always a SIBLING of the entry's link or toggle (a button never sits inside a link or a
 * button), so clicking it never navigates and never toggles the submenu. `onOpen` gets the button, which the popover returns focus to.
 */
export function UnseenBadgeButton({ count, testId, label, className = "", placement = "inline", expanded, onOpen }: {
  count: number; testId: string; label: string; className?: string; placement?: "inline" | "corner"; expanded: boolean; onOpen: (trigger: HTMLButtonElement) => void;
}) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      aria-label={`${count} ${label}`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      data-testid={testId}
      data-placement={placement}
      onClick={(event) => onOpen(event.currentTarget)}
      className={`${PILL} cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${className}`}
    >
      <span aria-hidden>{unseenText(count)}</span>
    </button>
  );
}
