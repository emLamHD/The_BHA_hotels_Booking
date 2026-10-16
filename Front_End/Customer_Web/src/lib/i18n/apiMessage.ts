"use client";

import { API_ERROR_PARAMS } from "@/lib/api/errorMessages";
import { useI18n } from "./I18nProvider";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: turns the message KEY a failed request stored (`shared.apiError.hold.expired`) into text in
 * the visitor's language now. A key this site has no text for (a code the API added later) reads as a generic error.
 */
export function useApiMessage() {
  const { t, has } = useI18n();
  return (key: string) => (has(key) ? t(key, API_ERROR_PARAMS) : t("shared.apiError.error.unknown"));
}
