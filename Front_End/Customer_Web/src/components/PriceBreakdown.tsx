"use client";

import React, { useMemo } from "react";
import { formatAsGiven, useDisplayAmounts, useMoneyFormat } from "@/lib/i18n/display";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import type { AppliedPromotionDto } from "@/lib/api/availabilityTypes";
import PromotionBadge from "@/components/PromotionBadge";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: a priced list (per-night rows and a total) in the visitor's currency. The VND amounts are
 * the booking API's; every figure on screen comes from ONE display-prices answer (one rate snapshot, each line rounded to
 * the currency's minor units, the total = the sum of the rounded lines). Amounts the API gave in another currency are
 * shown as given: the site never converts a currency it does not hold a rate for.
 */
export interface PriceRow {
  key: string;
  label: React.ReactNode;
  /** The amount the row shows (a night's total, or the rate for one night). */
  amount: number;
  /** The price of one room for that night, shown after the label when the API sent it (it matters when several rooms are booked). */
  unitAmount?: number;
  /** What the row would cost without a promotion; shown struck through only when it is more than `amount`. */
  listAmount?: number;
}

/** A promotion's effect on the stay: shown only when something was really discounted. */
export interface PriceDiscount {
  listTotal: number;
  discountTotal: number;
  promotion?: AppliedPromotionDto | null;
}

export interface PriceBreakdownProps {
  rows: PriceRow[];
  /** The stay total. The rows' sum is used when the API gave no rows. */
  totalAmount: number;
  currencyCode: string | null;
  totalLabel: React.ReactNode;
  /** The promotion's effect. Ignored unless `discountTotal` is above zero, so nothing is struck through without a real discount. */
  discount?: PriceDiscount;
  listClassName?: string;
  rowClassName?: string;
  totalClassName?: string;
  totalValueClassName?: string;
}

export default function PriceBreakdown({
  rows,
  totalAmount,
  currencyCode,
  totalLabel,
  discount,
  listClassName = "divide-y divide-neutral-100 dark:divide-neutral-800",
  rowClassName = "flex justify-between gap-4 py-1",
  totalClassName = "flex justify-between items-center border-t border-neutral-200/80 dark:border-neutral-700 pt-3",
  totalValueClassName = "text-base font-semibold text-secondary-500",
}: PriceBreakdownProps) {
  const t = useT();
  const { baseCurrency, formatLocale } = useI18n();
  const format = useMoneyFormat();
  const convertible = currencyCode === baseCurrency;
  const discounted = discount !== undefined && discount.discountTotal > 0 ? discount : null;
  // With rows the total is the SUM of the rounded rows (what the visitor can add up); without, the total is its own line.
  const lines = useMemo(() => {
    if (!convertible) return null;
    const own = rows.flatMap((row) => [
      { ref: row.key, unitVnd: String(row.amount), quantity: 1 },
      ...(row.unitAmount === undefined ? [] : [{ ref: `${row.key}:unit`, unitVnd: String(row.unitAmount), quantity: 1 }]),
      ...(row.listAmount !== undefined && row.listAmount > row.amount ? [{ ref: `${row.key}:list`, unitVnd: String(row.listAmount), quantity: 1 }] : []),
    ]);
    const extra = discounted
      ? [{ ref: "listTotal", unitVnd: String(discounted.listTotal), quantity: 1 }, { ref: "discountTotal", unitVnd: String(discounted.discountTotal), quantity: 1 }]
      : [];
    return [...(rows.length > 0 ? own : [{ ref: "total", unitVnd: String(totalAmount), quantity: 1 }]), ...extra];
  }, [convertible, rows, totalAmount, discounted]);
  const sums = useMemo(() => (rows.length > 0 ? [{ ref: "total", of: rows.map((row) => row.key) }] : []), [rows]);
  const state = useDisplayAmounts(lines, sums);

  const show = (ref: string, amount: number): React.ReactNode => {
    if (!convertible) return formatAsGiven(amount, currencyCode, formatLocale);
    if (state.status === "ready") {
      const found = state.quote.lines.find((line) => line.ref === ref) ?? state.quote.sums.find((sum) => sum.ref === ref);
      return found ? format(found.total) : "—";
    }
    if (state.status === "error") return <span title={state.message}>—</span>;
    return <span role="status" aria-label={t("shared.common.loading")} className="inline-block h-4 w-16 animate-pulse rounded bg-neutral-200 align-middle dark:bg-neutral-700" />;
  };

  return (
    <>
      {rows.length > 0 && (
        <ul className={listClassName}>
          {rows.map((row) => (
            <li key={row.key} className={rowClassName}>
              <span>
                {row.label}
                {row.unitAmount !== undefined && <> · {show(`${row.key}:unit`, row.unitAmount)}</>}
              </span>
              <span>
                {row.listAmount !== undefined && row.listAmount > row.amount && (
                  <del className="mr-2 text-neutral-400 dark:text-neutral-500">{show(`${row.key}:list`, row.listAmount)}</del>
                )}
                {show(row.key, row.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {discounted && (
        <div data-testid="price-discount" className="space-y-1 border-t border-neutral-200/80 pt-3 text-sm dark:border-neutral-700">
          <div className="flex justify-between gap-4 text-neutral-500 dark:text-neutral-400">
            <span>{t("customer.promotion.listPrice")}</span>
            <del>{show("listTotal", discounted.listTotal)}</del>
          </div>
          <div className="flex justify-between gap-4 text-emerald-700 dark:text-emerald-300">
            <span className="flex flex-wrap items-center gap-2">
              {t("customer.promotion.savings")}
              {discounted.promotion && <PromotionBadge promotion={discounted.promotion} />}
            </span>
            <span>−{show("discountTotal", discounted.discountTotal)}</span>
          </div>
        </div>
      )}
      <div className={totalClassName}>
        <span className="text-neutral-500 dark:text-neutral-400">{totalLabel}</span>
        <span className={totalValueClassName}>{show("total", totalAmount)}</span>
      </div>
    </>
  );
}
