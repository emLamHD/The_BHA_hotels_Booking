"use client";

import { useMemo } from "react";
import { useI18n } from "./I18nProvider";
import { formatInstant, formatStayDate } from "./dateFormat";

export { formatInstant, formatStayDate };

export function useDateFormat() {
  const { formatLocale } = useI18n();
  return useMemo(
    () => ({
      instant: (iso: string) => formatInstant(iso, formatLocale),
      stayDate: (isoDate: string) => formatStayDate(isoDate, formatLocale),
    }),
    [formatLocale]
  );
}
