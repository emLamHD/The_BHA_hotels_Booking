"use client";

import React, { useMemo } from "react";
import { useDisplayAmounts, useMoneyFormat } from "@/lib/i18n/display";
import { useT } from "@/lib/i18n/I18nProvider";

/**
 * CUST-WEB-HEADER-001-CP02-C2: one amount in the visitor's currency. `vnd` is the VND amount the booking data holds; the
 * converted figure is the server's (exact decimal, one rate snapshot). While it is on its way, or if it fails, a neutral
 * placeholder is shown — never 0, and never the VND figure under another symbol.
 */
export default function Money({ vnd, quantity = 1, className }: { vnd: number | string; quantity?: number; className?: string }) {
  const t = useT();
  const format = useMoneyFormat();
  const lines = useMemo(() => [{ ref: "a", unitVnd: String(vnd), quantity }], [vnd, quantity]);
  const state = useDisplayAmounts(lines);
  if (state.status === "ready") return <span className={className}>{format(state.quote.lines[0].total)}</span>;
  if (state.status === "error") return <span className={className} title={state.message}>—</span>;
  return (
    <span role="status" aria-label={t("shared.common.loading")} className={`inline-block h-4 w-20 animate-pulse rounded bg-neutral-200 align-middle dark:bg-neutral-700 ${className ?? ""}`} />
  );
}
