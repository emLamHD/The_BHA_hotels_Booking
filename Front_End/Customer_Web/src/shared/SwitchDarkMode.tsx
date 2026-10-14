"use client";

import React from "react";
import { MoonIcon } from "@heroicons/react/24/solid";
import { SunIcon } from "@heroicons/react/24/outline";
import { useThemeMode } from "@/utils/useThemeMode";
export interface SwitchDarkModeProps {
  className?: string;
}

/**
 * The template's light/dark button (CUST-WEB-001-CP08a-C2). It is a plain `type="button"`: it changes the theme
 * and nothing else — no navigation, no request, no reset of the page's state. Its name says what a press does,
 * and follows the real theme ("Bật chế độ tối" while light, "Bật chế độ sáng" while dark); the icon shows the
 * mode it switches to. `SwitchDarkMode2` is the same state as a labelled switch.
 */
const SwitchDarkMode: React.FC<SwitchDarkModeProps> = ({ className = "" }) => {
  const { _toogleDarkMode, isDarkMode } = useThemeMode();

  return (
    <button
      type="button"
      onClick={_toogleDarkMode}
      aria-label={isDarkMode ? "Bật chế độ sáng" : "Bật chế độ tối"}
      className={`self-center text-2xl md:text-3xl w-10 h-10 sm:w-12 sm:h-12 rounded-full text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 flex items-center justify-center ${className}`}
    >
      {isDarkMode ? (
        <SunIcon className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden="true" />
      ) : (
        <MoonIcon className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden="true" />
      )}
    </button>
  );
};

export default SwitchDarkMode;
