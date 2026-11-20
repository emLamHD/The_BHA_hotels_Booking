import React from "react";

/** The number as shown: 1–99, then `99+`. The label keeps the real number. */
export const unseenText = (count: number) => (count > 99 ? "99+" : String(count));

/**
 * BHA-NEWSLETTER-BADGE-001 / BHA-ADMIN-BADGE-001-PR04: the red counter beside a menu entry. Hidden at 0; never a template `new`/`pro` label. `corner` pins it to the corner of the
 * entry's icon, for a sidebar that is collapsed (no room for the text).
 */
export function UnseenBadge({ count, testId, label, corner = false }: { count: number; testId: string; label: string; corner?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      role="img"
      aria-label={`${count} ${label}`}
      data-testid={testId}
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-error-500 px-1.5 text-xs font-medium leading-none text-white ${
        corner ? "absolute -right-2 -top-2 ring-2 ring-white dark:ring-gray-900" : "ml-auto"
      }`}
    >
      <span aria-hidden>{unseenText(count)}</span>
    </span>
  );
}
