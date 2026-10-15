/**
 * CUST-WEB-HEADER-001-CP01: the header/menu type scale, in one place so the top menu, its dropdowns, the language /
 * currency button and the mobile drawer cannot drift apart. The family is Be Vietnam Pro (registered as
 * `--font-header` in the root layout): Poppins, the body font, has no Vietnamese subset, so letters such as "Ư"
 * fell back to a serif. Only the header and the drawer use it; the body keeps Poppins.
 */

/** Applied once on the header strip and once on the drawer (its dialog is portaled out of the header). */
export const HEADER_FONT = "font-[family-name:var(--font-header)]";

/** Main menu entries: 15px (16px from xl), weight 500. */
export const NAV_MAIN_TEXT = "text-[15px] xl:text-base font-medium leading-6";

/** Submenu entries: one step lighter (14px, weight 400). */
export const NAV_SUB_TEXT = "text-sm font-normal leading-5";

const NAV_HOVER =
  "hover:bg-neutral-100 hover:text-neutral-900 active:bg-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 dark:active:bg-neutral-700";

/** A main menu entry (link or dropdown button): one pill shape, hover, pressed and focus states, light and dark. */
export const NAV_MAIN_ITEM = `inline-flex items-center rounded-full px-4 py-2 ${NAV_MAIN_TEXT} text-neutral-700 dark:text-neutral-300 ${NAV_HOVER}`;

/** The Blog entry is a split pill (link + chevron button): same text and states, rounded on its own side only. */
export const NAV_MAIN_SPLIT_LEFT = `inline-flex items-center rounded-l-full py-2 pl-4 pr-1 ${NAV_MAIN_TEXT} text-neutral-700 dark:text-neutral-300 ${NAV_HOVER}`;
