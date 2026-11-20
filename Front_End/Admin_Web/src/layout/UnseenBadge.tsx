import React from "react";

/** The number as shown: 1–99, then `99+`. The label keeps the real number. */
export const unseenText = (count: number) => (count > 99 ? "99+" : String(count));

/** BHA-NEWSLETTER-BADGE-001: the red counter beside a menu entry. Hidden at 0; never a template `new`/`pro` label. */
export function UnseenBadge({ count, testId, label }: { count: number; testId: string; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      role="img"
      aria-label={`${count} ${label}`}
      data-testid={testId}
      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-error-500 px-1.5 text-xs font-medium leading-none text-white"
    >
      <span aria-hidden>{unseenText(count)}</span>
    </span>
  );
}

/** A small red dot on a parent entry (or its icon, when the sidebar is collapsed) while something inside it has not been seen. */
export function UnseenDot({ testId, label }: { testId: string; label: string }) {
  return <span role="img" aria-label={label} data-testid={testId} className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-error-500 ring-2 ring-white dark:ring-gray-900" />;
}
