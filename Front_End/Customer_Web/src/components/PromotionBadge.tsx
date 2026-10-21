"use client";

import React from "react";
import type { AppliedPromotionDto } from "@/lib/api/availabilityTypes";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * The promotion the backend applied, said from its rule (never typed text, so the words cannot differ from the price). The
 * promotion's own title is the content source language's text, so it is shown only in that language; other languages read the rule.
 */
export function promotionLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string,
  promotion: Pick<AppliedPromotionDto, "kind" | "value" | "title">
): string {
  const rule = promotion.kind === "Percent" ? t("customer.promotion.percentOff", { percent: promotion.value }) : t("customer.promotion.fixedOff");
  return locale === "vi" && promotion.title ? `${promotion.title} · ${rule}` : rule;
}

export default function PromotionBadge({ promotion, className = "" }: { promotion: AppliedPromotionDto; className?: string }) {
  const { t, locale } = useI18n();
  return (
    <span
      data-testid="promotion-badge"
      className={`inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 ${className}`}
    >
      {promotionLabel(t, locale, promotion)}
    </span>
  );
}
