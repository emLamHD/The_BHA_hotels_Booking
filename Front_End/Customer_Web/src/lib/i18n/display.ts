"use client";

import { useEffect, useMemo, useState } from "react";
import { getApiBaseUrl } from "@/lib/api/env";
import { useI18n } from "./I18nProvider";

/**
 * CUST-WEB-HEADER-001-CP02-C2: display prices. The authority for every amount is the VND the booking API returned;
 * what is shown in another currency is `POST /api/v1/website/display-prices` — exact decimal arithmetic on the
 * server, one rate snapshot per request, rounding to the currency's minor units per line and totals as the sum of the
 * rounded lines — never a floating point calculation here. VND (the base currency) is shown as stored: no request.
 * While the answer is on its way, or if it fails, the amount is NOT shown as 0 or as VND with another symbol: the
 * hook says `loading` / `error` and the caller shows a neutral placeholder.
 */

export interface DisplayLine {
  ref: string;
  unitVnd: string;
  quantity: number;
}

export interface DisplaySum {
  ref: string;
  of: string[];
}

export interface DisplayQuote {
  currency: string;
  minorUnits: number;
  isBase: boolean;
  rate: { vndPerUnit: string; updatedAtUtc: string; version: number };
  lines: { ref: string; unit: string; quantity: number; total: string }[];
  sums: { ref: string; total: string }[];
}

export type DisplayState =
  | { status: "ready"; quote: DisplayQuote }
  | { status: "loading" }
  | { status: "error"; message: string };

const cache = new Map<string, DisplayQuote>();
const inFlight = new Map<string, Promise<DisplayQuote>>();

export async function requestDisplayQuote(currency: string, lines: DisplayLine[], sums: DisplaySum[]): Promise<DisplayQuote> {
  const key = JSON.stringify([currency, lines, sums]);
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = fetch(`${getApiBaseUrl()}/api/v1/website/display-prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "omit",
    body: JSON.stringify({ currency, lines, sums }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const quote = (await response.json()) as DisplayQuote;
      cache.set(key, quote);
      return quote;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/** The base currency needs no request: its amounts are the stored ones. */
function localQuote(currency: string, minorUnits: number, lines: DisplayLine[], sums: DisplaySum[]): DisplayQuote {
  const totals = new Map(lines.map((line) => [line.ref, Number(line.unitVnd) * line.quantity]));
  return {
    currency,
    minorUnits,
    isBase: true,
    rate: { vndPerUnit: "1", updatedAtUtc: "", version: 0 },
    lines: lines.map((line) => ({ ref: line.ref, unit: line.unitVnd, quantity: line.quantity, total: String(totals.get(line.ref)) })),
    sums: sums.map((sum) => ({ ref: sum.ref, total: String(sum.of.reduce((total, ref) => total + (totals.get(ref) ?? 0), 0)) })),
  };
}

/** The amounts of one screen, in the visitor's currency. Pass `null` while there is nothing to price. */
export function useDisplayAmounts(lines: DisplayLine[] | null, sums: DisplaySum[] = []): DisplayState {
  const { currency, baseCurrency, currencies } = useI18n();
  const key = useMemo(() => JSON.stringify([currency, lines, sums]), [currency, lines, sums]);
  const [state, setState] = useState<{ key: string; value: DisplayState } | null>(null);

  useEffect(() => {
    if (lines === null || lines.length === 0) return;
    if (currency === baseCurrency) return;
    let cancelled = false;
    requestDisplayQuote(currency, lines, sums)
      .then((quote) => !cancelled && setState({ key, value: { status: "ready", quote } }))
      .catch((error: unknown) =>
        !cancelled && setState({ key, value: { status: "error", message: error instanceof Error ? error.message : "The prices could not be read." } })
      );
    return () => {
      cancelled = true;
    };
    // `key` carries currency, lines and sums.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (lines === null || lines.length === 0) return { status: "loading" };
  if (currency === baseCurrency) {
    const minor = currencies.find((item) => item.code === currency)?.minorUnits ?? 0;
    return { status: "ready", quote: localQuote(currency, minor, lines, sums) };
  }
  if (state && state.key === key) return state.value;
  return { status: "loading" };
}

/** Formats a decimal string the server produced (`"40.00"`, `"1089000"`) in the visitor's format locale, with the currency's own symbol and digits. */
export function formatMoney(amount: string, currency: string, minorUnits: number, formatLocale: string): string {
  const digits = Math.max(0, minorUnits);
  return new Intl.NumberFormat(formatLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(amount));
}

/** An amount in a currency the site holds no rate for: shown exactly as the API gave it (no conversion, no invented currency). */
export function formatAsGiven(amount: number, currencyCode: string | null, formatLocale: string): string {
  if (currencyCode) {
    try {
      return new Intl.NumberFormat(formatLocale, { style: "currency", currency: currencyCode }).format(amount);
    } catch {
      /* an unknown code is shown next to the plain number below */
    }
  }
  const plain = new Intl.NumberFormat(formatLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return currencyCode ? `${plain} ${currencyCode}` : plain;
}

/** The formatter bound to the visitor's locale and the chosen currency. */
export function useMoneyFormat() {
  const { currency, currencies, formatLocale } = useI18n();
  const minorUnits = currencies.find((item) => item.code === currency)?.minorUnits ?? 0;
  return useMemo(() => (amount: string) => formatMoney(amount, currency, minorUnits, formatLocale), [currency, minorUnits, formatLocale]);
}
