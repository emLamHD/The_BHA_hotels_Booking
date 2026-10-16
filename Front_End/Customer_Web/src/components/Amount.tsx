"use client";

import React from "react";
import Money from "@/components/Money";
import { formatAsGiven } from "@/lib/i18n/display";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: one amount the booking API returned, in the visitor's currency. An amount in the
 * site's base currency (VND) is converted by the server (see `Money`); an amount in any other currency is shown as the
 * API gave it — never converted by a rate the site does not hold, never given another currency's symbol.
 */
export default function Amount({ amount, currencyCode, className }: { amount: number; currencyCode: string | null; className?: string }) {
  const { baseCurrency, formatLocale } = useI18n();
  if (currencyCode === baseCurrency) return <Money vnd={amount} className={className} />;
  return <span className={className}>{formatAsGiven(amount, currencyCode, formatLocale)}</span>;
}
