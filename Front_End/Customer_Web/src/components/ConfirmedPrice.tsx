"use client";

import React from "react";
import PriceBreakdown from "@/components/PriceBreakdown";
import { useDateFormat } from "@/lib/i18n/dates";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { PriceQuote } from "@/lib/api/availabilityTypes";

/** The price the guest is about to confirm, with how a promotion changed it: exactly what is sent as the expected price. */
export default function ConfirmedPrice({ quote, label }: { quote: PriceQuote; label: string }) {
  const { t } = useI18n();
  const dates = useDateFormat();
  return (
    <div data-testid="confirmed-price" className="space-y-1 text-sm">
      <p className="font-medium text-neutral-700 dark:text-neutral-200">{label}</p>
      <PriceBreakdown
        rows={quote.nightlyRates.map((rate) => ({ key: rate.stayDate, label: dates.stayDate(rate.stayDate), amount: rate.amount, listAmount: rate.listAmount ?? undefined }))}
        totalAmount={quote.totalAmount}
        currencyCode={quote.currencyCode}
        totalLabel={t("customer.booking.offer.total")}
        discount={{ listTotal: quote.listTotalAmount, discountTotal: quote.discountTotalAmount, promotion: quote.appliedPromotion }}
        totalClassName="mt-2 flex justify-between items-center border-t border-neutral-200/80 dark:border-neutral-700 pt-2"
      />
    </div>
  );
}
